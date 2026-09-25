import base64
import json
import os
import urllib.error
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Conversation, Diagnosis, Media, Message
from .services.gemini import _fallback_diagnosis, _generate_content, _generate_content_rest


class ProviderError(Exception):
    def __init__(self, status_code):
        self.status_code = status_code


class GeminiRetryTests(TestCase):
    parts = [{"text": "Diagnose this engine symptom."}]

    def test_successful_sdk_response(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch(
            'chatbot.services.gemini._generate_content_sdk', return_value='SDK response'
        ) as sdk, patch('chatbot.services.gemini._generate_content_rest') as rest:
            self.assertEqual(_generate_content(self.parts), 'SDK response')
        sdk.assert_called_once_with(self.parts, None)
        rest.assert_not_called()

    def test_sdk_503_retries_then_succeeds(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch(
            'chatbot.services.gemini._generate_content_sdk',
            side_effect=[ProviderError(503), 'SDK recovered'],
        ) as sdk, patch('chatbot.services.gemini.time.sleep'):
            self.assertEqual(_generate_content(self.parts), 'SDK recovered')
        self.assertEqual(sdk.call_count, 2)

    def test_sdk_failure_uses_rest_fallback(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch(
            'chatbot.services.gemini._generate_content_sdk',
            side_effect=RuntimeError('SDK unavailable'),
        ), patch(
            'chatbot.services.gemini._generate_content_rest', return_value='REST response'
        ) as rest:
            self.assertEqual(_generate_content(self.parts), 'REST response')
        rest.assert_called_once_with(self.parts, None)

    def test_rest_503_retries_then_succeeds(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch(
            'chatbot.services.gemini._generate_content_rest_once',
            side_effect=[urllib.error.HTTPError('url', 503, 'busy', {}, None), 'REST recovered'],
        ) as rest, patch('chatbot.services.gemini.time.sleep'):
            self.assertEqual(_generate_content_rest(self.parts), 'REST recovered')
        self.assertEqual(rest.call_count, 2)

    def test_rest_401_and_403_do_not_retry(self):
        for status_code in (401, 403):
            with self.subTest(status_code=status_code):
                error = urllib.error.HTTPError('url', status_code, 'permanent failure', {}, None)
                with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch(
                    'chatbot.services.gemini._generate_content_rest_once', side_effect=error
                ) as rest, patch('chatbot.services.gemini.time.sleep') as sleep:
                    with self.assertRaises(urllib.error.HTTPError):
                        _generate_content_rest(self.parts)
                rest.assert_called_once()
                sleep.assert_not_called()

    def test_final_fallback_only_after_all_attempts_fail(self):
        sdk_error = ProviderError(503)
        rest_error = urllib.error.HTTPError('url', 504, 'busy', {}, None)
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}), patch(
            'chatbot.services.gemini._generate_content_sdk', side_effect=sdk_error
        ) as sdk, patch(
            'chatbot.services.gemini._generate_content_rest_once', side_effect=rest_error
        ) as rest, patch('chatbot.services.gemini.time.sleep'):
            with self.assertRaises(urllib.error.HTTPError):
                _generate_content(self.parts)
        self.assertEqual(sdk.call_count, 4)
        self.assertEqual(rest.call_count, 4)


class ChatbotApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_greeting_skips_gemini(self):
        with patch('chatbot.services.gemini._generate_content') as generate:
            response = self.client.post('/api/chat/', {'message': 'Hi'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertIn('AI mechanic', response.data['assistant_response'])
        generate.assert_not_called()

    def test_unrelated_question_skips_gemini(self):
        with patch('chatbot.services.gemini._generate_content') as generate:
            response = self.client.post(
                '/api/chat/', {'message': 'What is the capital of France?'}, format='json'
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn('vehicle diagnostics', response.data['assistant_response'])
        generate.assert_not_called()

    def test_automotive_message_reaches_gemini_with_exact_context(self):
        with patch(
            'chatbot.services.gemini._generate_content',
            return_value='A detached wheel is unsafe. Do not drive; arrange towing and inspection.',
        ) as generate:
            response = self.client.post(
                '/api/chat/',
                {'message': 'gadi k ek tyre hi nikal gaya'},
                format='json',
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn('detached wheel', response.data['assistant_response'])
        prompt = generate.call_args.args[0][0]['text']
        self.assertIn('gadi k ek tyre hi nikal gaya', prompt)
        self.assertIn('primary reasoning engine', prompt)

    def test_car_wont_start_reaches_gemini(self):
        with patch(
            'chatbot.services.gemini._generate_content',
            return_value='Check the battery and starter circuit before further diagnosis.',
        ) as generate:
            response = self.client.post(
                '/api/chat/', {'message': "My car won't start."}, format='json'
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("My car won't start.", generate.call_args.args[0][0]['text'])

    def test_high_risk_fallback_is_not_driveable(self):
        for symptom in (
            'brake failure', 'steering failure', 'detached wheel', 'fuel leak',
            'smoke and fire', 'severe overheating', 'dangerous tyre damage',
        ):
            with self.subTest(symptom=symptom):
                result = _fallback_diagnosis([Message(content=symptom)])
                self.assertEqual(result['urgency'], 'high')

    def test_follow_up_history_reaches_gemini_without_category_router(self):
        conversation = Conversation.objects.create()
        Message.objects.create(
            conversation=conversation,
            role=Message.ROLE_USER,
            content='meri car start nahi ho rahi',
        )
        Message.objects.create(
            conversation=conversation,
            role=Message.ROLE_ASSISTANT,
            content='Engine crank karta hai ya bilkul response nahi deta?',
        )
        with patch(
            'chatbot.services.gemini._generate_content',
            return_value='Dashboard lights aur clicking sound check karte hain.',
        ) as generate:
            response = self.client.post(
                '/api/chat/',
                {'conversation_id': conversation.id, 'message': 'haan'},
                format='json',
            )
        self.assertEqual(response.status_code, 200)
        prompt = generate.call_args.args[0][0]['text']
        self.assertIn('meri car start nahi ho rahi', prompt)
        self.assertIn('haan', prompt)

    def test_gemini_failure_returns_controlled_fallback(self):
        with patch(
            'chatbot.services.gemini._generate_content',
            side_effect=RuntimeError('temporary provider failure'),
        ):
            response = self.client.post(
                '/api/chat/', {'message': 'engine se knocking aa rahi hai'}, format='json'
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn('share your vehicle year', response.data['assistant_response'].lower())
        self.assertNotIn('temporary provider failure', response.data['assistant_response'])

    def test_gemini_failure_gives_booking_guidance(self):
        with patch(
            'chatbot.services.gemini._generate_content',
            side_effect=RuntimeError('temporary provider failure'),
        ):
            response = self.client.post(
                '/api/chat/', {'message': 'Should I book a mechanic?'}, format='json'
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn('booking a mechanic is sensible', response.data['assistant_response'].lower())

    def test_diagnosis_preserves_existing_response_shape(self):
        conversation = Conversation.objects.create()
        Message.objects.create(
            conversation=conversation,
            role=Message.ROLE_USER,
            content='The engine is knocking at idle.',
        )
        result = json.dumps({
            'problem_summary': 'Engine noise reported at idle.',
            'possible_causes': 'Oil pressure, valvetrain, or internal wear.',
            'most_likely_issue': 'A mechanical noise requiring inspection.',
            'recommended_service': 'Stop if the knock is deep and arrange inspection.',
            'urgency': 'high',
        })
        with patch('chatbot.services.gemini._generate_content', return_value=result):
            response = self.client.post(
                '/api/diagnosis/', {'conversation_id': conversation.id}, format='json'
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(response.data),
            {'problem_summary', 'possible_causes', 'most_likely_issue', 'recommended_service', 'urgency'},
        )
        self.assertEqual(response.data['urgency'], 'high')

    def test_image_is_passed_to_diagnosis_gemini(self):
        conversation = Conversation.objects.create()
        Message.objects.create(
            conversation=conversation,
            role=Message.ROLE_USER,
            content='Dashboard par red warning light aa rahi hai.',
        )
        upload = self.client.post(
            '/api/upload/',
            {
                'conversation_id': conversation.id,
                'media_type': 'image',
                'file': SimpleUploadedFile('dashboard.jpg', b'image-bytes', content_type='image/jpeg'),
            },
            format='multipart',
        )
        self.assertEqual(upload.status_code, 201)
        result = json.dumps({
            'problem_summary': 'Dashboard warning light visible.',
            'possible_causes': 'Several systems can trigger this light.',
            'most_likely_issue': 'Requires identification of the exact symbol.',
            'recommended_service': 'Inspect the warning system and scan codes.',
            'urgency': 'medium',
        })
        with patch('chatbot.services.gemini._generate_content', return_value=result) as generate:
            response = self.client.post(
                '/api/diagnosis/', {'conversation_id': conversation.id}, format='json'
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(generate.call_args.args[0]), 2)
        image_part = generate.call_args.args[0][1]['inline_data']
        self.assertEqual(base64.b64decode(image_part['data']), b'image-bytes')

    def test_chat_uploads_image_before_gemini_and_sends_bytes(self):
        with patch(
            'chatbot.services.gemini._generate_content',
            return_value='The image is available for visual inspection.',
        ) as generate:
            response = self.client.post(
                '/api/chat/',
                {
                    'message': 'Please inspect this dashboard warning image.',
                    'files': SimpleUploadedFile(
                        'dashboard.jpg', b'chat-image-bytes', content_type='image/jpeg'
                    ),
                },
                format='multipart',
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Media.objects.count(), 1)
        image_part = generate.call_args.args[0][1]['inline_data']
        self.assertEqual(base64.b64decode(image_part['data']), b'chat-image-bytes')

    def test_audio_is_not_presented_as_analyzed(self):
        with patch('chatbot.services.gemini._generate_content') as generate:
            response = self.client.post(
                '/api/chat/',
                {
                    'message': 'Please inspect this engine sound.',
                    'files': SimpleUploadedFile(
                        'engine.webm', b'audio-bytes', content_type='audio/webm'
                    ),
                },
                format='multipart',
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn('cannot analyze those media types yet', response.data['assistant_response'])
        generate.assert_not_called()

    def test_booking_api_remains_available(self):
        conversation = Conversation.objects.create()
        Diagnosis.objects.create(
            conversation=conversation,
            problem_summary='Wheel inspection required.',
            most_likely_issue='Detached wheel',
            recommended_service='Tow for inspection.',
            urgency='high',
        )
        response = self.client.post(
            '/api/booking/',
            {
                'conversation_id': conversation.id,
                'customer_name': 'Test Customer',
                'phone': '+91 9876543210',
                'vehicle_model': 'Honda City',
                'preferred_date': '2026-10-01',
                'preferred_time': '10:00:00',
                'issue_description': 'Wheel inspection required.',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        detail = self.client.get(f"/api/booking/{response.data['id']}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data['phone'], '+91 9876543210')
