from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Booking, Conversation, Diagnosis, Media, Message
from .serializers import (
    BookingRequestSerializer,
    BookingSerializer,
    ChatRequestSerializer,
    DiagnosisRequestSerializer,
    MediaUploadSerializer,
)
from .services.gemini import generate_chat_reply, generate_diagnosis


def _media_type_for_file(uploaded_file):
    content_type = uploaded_file.content_type or ""
    if content_type.startswith("audio/"):
        return Media.MEDIA_AUDIO
    if content_type.startswith("video/"):
        return Media.MEDIA_VIDEO
    return Media.MEDIA_IMAGE


class ChatView(APIView):
    def post(self, request, *args, **kwargs):
        serializer = ChatRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        conversation_id = serializer.validated_data.get("conversation_id")
        user_message = serializer.validated_data["message"]

        if conversation_id:
            try:
                conversation = Conversation.objects.get(pk=conversation_id)
            except Conversation.DoesNotExist:
                return Response(
                    {"detail": "Invalid conversation ID."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            conversation = Conversation.objects.create()

        user_msg = Message.objects.create(
            conversation=conversation,
            role=Message.ROLE_USER,
            content=user_message,
        )

        for uploaded_file in request.FILES.getlist("files"):
            Media.objects.create(
                conversation=conversation,
                message=user_msg,
                file=uploaded_file,
                media_type=_media_type_for_file(uploaded_file),
            )

        assistant_reply = generate_chat_reply(
            conversation.messages.all(),
            user_message,
            conversation.media_files.all(),
        )
        assistant_msg = Message.objects.create(
            conversation=conversation,
            role=Message.ROLE_ASSISTANT,
            content=assistant_reply,
        )

        return Response(
            {
                "conversation_id": conversation.id,
                "user_message": user_msg.content,
                "assistant_response": assistant_msg.content,
            },
            status=status.HTTP_200_OK,
        )


class MediaUploadView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        serializer = MediaUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated = serializer.validated_data
        conversation_id = validated["conversation_id"]
        message_id = validated.get("message_id")
        uploaded_file = validated["file"]
        media_type = validated["media_type"]

        conversation = Conversation.objects.get(pk=conversation_id)
        message = None
        if message_id is not None:
            message = Message.objects.filter(pk=message_id, conversation=conversation).first()
            if message is None:
                return Response(
                    {"detail": "Invalid message ID for this conversation."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        media = Media.objects.create(
            conversation=conversation,
            message=message,
            file=uploaded_file,
            media_type=media_type,
        )

        return Response(
            {
                "id": media.id,
                "conversation_id": media.conversation_id,
                "message_id": media.message_id,
                "file_name": media.file.name,
                "file_size": media.file.size,
                "media_type": media.media_type,
                "uploaded_at": media.uploaded_at,
            },
            status=status.HTTP_201_CREATED,
        )


class DiagnosisView(APIView):
    def post(self, request, *args, **kwargs):
        serializer = DiagnosisRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        conversation_id = serializer.validated_data["conversation_id"]
        conversation = Conversation.objects.get(pk=conversation_id)

        diagnosis_data = generate_diagnosis(
            conversation.messages.all(),
            conversation.media_files.filter(media_type=Media.MEDIA_IMAGE),
        )

        diagnosis, created = Diagnosis.objects.update_or_create(
            conversation=conversation,
            defaults={
                "problem_summary": diagnosis_data["problem_summary"],
                "possible_causes": diagnosis_data["possible_causes"],
                "most_likely_issue": diagnosis_data["most_likely_issue"],
                "recommended_service": diagnosis_data["recommended_service"],
                "urgency": diagnosis_data["urgency"],
            },
        )

        return Response(
            {
                "problem_summary": diagnosis.problem_summary,
                "possible_causes": diagnosis.possible_causes,
                "most_likely_issue": diagnosis.most_likely_issue,
                "recommended_service": diagnosis.recommended_service,
                "urgency": diagnosis.urgency,
            },
            status=status.HTTP_200_OK,
        )


class BookingView(APIView):
    def post(self, request, *args, **kwargs):
        serializer = BookingRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated = serializer.validated_data
        conversation = Conversation.objects.get(pk=validated["conversation_id"])

        booking = Booking.objects.create(
            conversation=conversation,
            customer_name=validated["customer_name"],
            phone=validated["phone"],
            vehicle_model=validated["vehicle_model"],
            preferred_date=validated["preferred_date"],
            preferred_time=validated["preferred_time"],
            issue_description=validated["issue_description"],
            status=Booking.STATUS_PENDING,
        )

        response = BookingSerializer(booking).data
        return Response(
            {
                "id": booking.id,
                "booking": response,
            },
            status=status.HTTP_201_CREATED,
        )


class BookingDetailView(APIView):
    def get(self, request, id, *args, **kwargs):
        booking = get_object_or_404(Booking, pk=id)
        serializer = BookingSerializer(booking)
        return Response(serializer.data, status=status.HTTP_200_OK)
