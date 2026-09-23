from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework import serializers

from .models import Booking, Conversation, Diagnosis, Media, Message


class ConversationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Conversation
        fields = ["id", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "conversation", "role", "content", "created_at"]
        read_only_fields = ["id", "created_at"]


class MediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Media
        fields = ["id", "conversation", "message", "file", "media_type", "uploaded_at"]
        read_only_fields = ["id", "uploaded_at"]

    def validate_media_type(self, value):
        valid_types = {choice[0] for choice in Media.MEDIA_TYPE_CHOICES}
        if value not in valid_types:
            raise serializers.ValidationError("Unsupported media type.")
        return value


class DiagnosisSerializer(serializers.ModelSerializer):
    class Meta:
        model = Diagnosis
        fields = [
            "id",
            "conversation",
            "problem_summary",
            "possible_causes",
            "most_likely_issue",
            "recommended_service",
            "urgency",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class BookingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = [
            "id",
            "conversation",
            "customer_name",
            "phone",
            "vehicle_model",
            "preferred_date",
            "preferred_time",
            "issue_description",
            "status",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        required_fields = [
            "customer_name",
            "phone",
            "vehicle_model",
            "preferred_date",
            "preferred_time",
            "issue_description",
        ]
        for field_name in required_fields:
            if not attrs.get(field_name):
                raise serializers.ValidationError({field_name: "This field is required."})
        if not Diagnosis.objects.filter(conversation_id=attrs["conversation_id"]).exists():
            raise serializers.ValidationError({
                "conversation_id": "A completed diagnosis is required before booking.",
            })
        return attrs


class ChatRequestSerializer(serializers.Serializer):
    conversation_id = serializers.IntegerField(required=False, allow_null=True)
    message = serializers.CharField(required=True, allow_blank=False, trim_whitespace=True)


class MediaUploadSerializer(serializers.Serializer):
    conversation_id = serializers.IntegerField(required=True)
    message_id = serializers.IntegerField(required=False, allow_null=True)
    file = serializers.FileField(required=True)
    media_type = serializers.CharField(required=True)

    def validate_media_type(self, value):
        valid_types = {choice[0] for choice in Media.MEDIA_TYPE_CHOICES}
        if value not in valid_types:
            raise serializers.ValidationError("Unsupported media type.")
        return value

    def validate_conversation_id(self, value):
        if not Conversation.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Invalid conversation ID.")
        return value

    def validate_message_id(self, value):
        if value is None:
            return value
        if not Message.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Invalid message ID.")
        return value


class DiagnosisRequestSerializer(serializers.Serializer):
    conversation_id = serializers.IntegerField(required=True)

    def validate_conversation_id(self, value):
        if not Conversation.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Invalid conversation ID.")
        return value


class BookingRequestSerializer(serializers.Serializer):
    conversation_id = serializers.IntegerField(required=True)
    customer_name = serializers.CharField(required=True, allow_blank=False)
    phone = serializers.CharField(required=True, allow_blank=False)
    vehicle_model = serializers.CharField(required=True, allow_blank=False)
    preferred_date = serializers.DateField(required=True)
    preferred_time = serializers.TimeField(required=True)
    issue_description = serializers.CharField(required=True, allow_blank=False)

    def validate_conversation_id(self, value):
        if not Conversation.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Invalid conversation ID.")
        return value
