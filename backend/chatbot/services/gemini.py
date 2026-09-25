import json
import logging
import os
import random
import re
import base64
import ssl
import time
import urllib.error
import urllib.request
from typing import Any, Iterable

import certifi

from chatbot.models import Media, Message

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.6-flash"
MAX_HISTORY_MESSAGES = 8
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_RETRIES = 3
RETRY_BASE_DELAY_SECONDS = 0.5
DAILY_LIMIT_ERROR = "DAILY_LIMIT_REACHED"
DAILY_LIMIT_MESSAGE = "Daily AI limit reached. Please try again tomorrow."
AUTOMOTIVE_TERMS = (
    "car", "truck", "vehicle", "engine", "brake", "brakes", "tire", "tyre",
    "wheel", "oil", "coolant", "radiator", "battery", "alternator", "starter",
    "transmission", "clutch", "gear", "exhaust", "smoke", "steering", "suspension",
    "check engine", "dashboard", "warning light", "obd", "misfire", "overheat",
    "overheating", "noise", "squeal", "squeak", "knock", "rattle", "vibrate",
    "leak", "fluid", "ac", "air conditioning", "mileage", "rpm", "idle",
    "acceleration", "fuel", "hose", "belt", "spark plug", "cooling",
    "gadi", "gaadi", "car ki", "start nahi", "start nhi", "crank nahi",
    "crank nhi", "band ho", "kharab", "brake kaam", "awaz", "awaaz",
    "dhua", "dhuaan", "tel leak", "paani leak", "garam", "overheat ho",
)


class DailyLimitReachedError(RuntimeError):
    code = DAILY_LIMIT_ERROR
    message = DAILY_LIMIT_MESSAGE

    def __init__(self):
        super().__init__(self.message)
NON_AUTOMOTIVE_TERMS = (
    "poem", "recipe", "brownie", "movie", "song", "lyrics", "weather", "bitcoin",
    "dating", "essay", "homework", "javascript", "python", "react", "programming",
    "president", "capital of", "stock market", "horoscope",
)


def _api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def _model_name() -> str:
    return os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def is_automotive_query(text: str) -> bool:
    normalized = text.lower()
    return any(term in normalized for term in AUTOMOTIVE_TERMS)


def _is_non_automotive_query(text: str) -> bool:
    normalized = text.lower()
    return any(term in normalized for term in NON_AUTOMOTIVE_TERMS) and not is_automotive_query(text)


def deterministic_reply(text: str) -> str | None:
    normalized = text.lower().strip()
    if re.fullmatch(r"(?:hi|hello|hey|howdy|good morning|good afternoon|good evening)[!. ]*", normalized):
        return (
            "Hello. I’m your AI mechanic. Tell me the year, make, and model of the vehicle, "
            "then describe the symptom, warning light, sound, or smell you’re noticing."
        )
    if re.fullmatch(r"(?:thanks|thank you|thx)[!. ]*", normalized):
        return "You’re welcome. Share any new symptom or detail and I’ll help you narrow it down."
    if _is_non_automotive_query(text):
        return (
            "I can help with vehicle diagnostics, mechanical symptoms, warning lights, "
            "and repair next steps. Please describe an issue with a car or other vehicle."
        )
    return None


def _fallback_chat_reply(text: str, messages: Iterable[Message] = ()) -> str:
    recent_user_messages = [
        message.content.strip()
        for message in list(messages)[-MAX_HISTORY_MESSAGES:]
        if message.role == Message.ROLE_USER and message.content.strip()
    ]
    context = " ".join(recent_user_messages).lower()
    normalized = text.lower().strip()
    combined = f"{context} {normalized}"
    urgent_terms = (
        "brake", "steering", "fuel leak", "smoke", "fire", "overheat",
        "wheel came off", "tyre came off", "tire came off", "not stopping",
    )

    if any(term in combined for term in urgent_terms):
        return (
            "Because you mentioned a potentially safety-critical symptom, stop in a safe place, "
            "switch the vehicle off, and do not drive it until a qualified mechanic inspects it. "
            "Arrange towing if it cannot be safely moved."
        )
    if "book" in normalized and "mechanic" in normalized:
        return (
            "Booking a mechanic is sensible if the symptom is recurring, worsening, or affecting "
            "starting, braking, steering, overheating, or warning lights. If the car is safe to "
            "drive, share the symptom, warning light, and when it occurs so I can help you decide "
            "how urgent the inspection is."
        )
    if any(phrase in normalized for phrase in ("what should i do", "what do i do", "next step", "now")):
        return (
            "Park safely and note exactly what you observed: the symptom, warning lights, sound or "
            "smell, and whether the car starts and drives normally. Do not keep driving if braking, "
            "steering, smoke, fuel leaks, or severe overheating are involved. Share those details "
            "and your vehicle year, make, and model for the next step."
        )
    return (
        "I can help narrow this down. Please share your vehicle year, make, and model, what you "
        "noticed, when it happens, and any dashboard warning light. If the symptom affects braking "
        "or steering, or there is smoke, a fuel leak, or severe overheating, stop driving and arrange "
        "a professional inspection."
    )


def _history_text(messages: Iterable[Message]) -> str:
    recent = list(messages)[-MAX_HISTORY_MESSAGES:]
    return "\n".join(f"{message.role}: {message.content}" for message in recent if message.content)


def _image_parts(media: Iterable[Media]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    for item in media:
        if item.media_type != Media.MEDIA_IMAGE or item.file.size > MAX_IMAGE_BYTES:
            continue
        item.file.open("rb")
        try:
            parts.append({
                "inline_data": {
                    "mime_type": getattr(item.file.file, "content_type", None) or "image/jpeg",
                    "data": base64.b64encode(item.file.read()).decode("ascii"),
                }
            })
        finally:
            item.file.close()
    return parts


def _status_code(exc: BaseException) -> int | None:
    for source in (exc, getattr(exc, "response", None)):
        if source is None:
            continue
        for attribute in ("status_code", "status", "code"):
            value = getattr(source, attribute, None)
            if isinstance(value, int):
                return value
    code = getattr(exc, "code", None)
    return code if isinstance(code, int) else None


def _provider_error_text(exc: BaseException) -> str:
    values = [str(exc)]
    for source in (exc, getattr(exc, "response", None)):
        if source is None:
            continue
        body = getattr(source, "body", None)
        if body:
            values.append(str(body))
        read = getattr(source, "read", None)
        if callable(read):
            try:
                body = read()
            except Exception:
                body = None
            if body:
                values.append(body.decode("utf-8", "ignore") if isinstance(body, bytes) else str(body))
    return " ".join(values).lower()


def _is_daily_quota_exhausted(exc: BaseException) -> bool:
    error_text = _provider_error_text(exc)
    has_resource_exhausted = "resource_exhausted" in error_text or "resource exhausted" in error_text
    quota_markers = (
        "generaterequestsperdaypermodel-freetier",
        "generate_content_free_tier_requests",
        "daily quota",
        "daily request",
        "requests per day",
        "project quota",
        "model quota",
        "quota exceeded",
    )
    return has_resource_exhausted and any(marker in error_text for marker in quota_markers)


def _is_transient_error(exc: BaseException) -> bool:
    if _is_daily_quota_exhausted(exc):
        return False
    status_code = _status_code(exc)
    if status_code is not None:
        return status_code in {429, 500, 502, 503, 504}

    if isinstance(exc, (TimeoutError, ConnectionError, urllib.error.URLError)):
        return True

    error_name = type(exc).__name__.lower()
    error_text = str(exc).lower()
    return any(
        marker in error_name or marker in error_text
        for marker in ("timeout", "timed out", "connection reset", "temporarily unavailable")
    )


def _with_retries(operation, provider: str) -> str:
    for retry_number in range(MAX_RETRIES + 1):
        try:
            return operation()
        except Exception as exc:
            if _is_daily_quota_exhausted(exc):
                raise DailyLimitReachedError from None
            if not _is_transient_error(exc) or retry_number == MAX_RETRIES:
                raise
            delay = RETRY_BASE_DELAY_SECONDS * (2 ** retry_number)
            delay += random.uniform(0, RETRY_BASE_DELAY_SECONDS)
            logger.warning(
                "Transient Gemini %s failure; retrying in %.2f seconds: %s",
                provider,
                delay,
                exc,
            )
            time.sleep(delay)
    raise RuntimeError("Gemini retry loop ended unexpectedly")


def _generate_content_rest_once(
    parts: list[dict[str, Any]], response_mime_type: str | None = None
) -> str:
    key = _api_key()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    payload: dict[str, Any] = {
        "contents": [{"role": "user", "parts": parts}],
    }
    if response_mime_type:
        payload["generationConfig"] = {
            "temperature": 0.2,
            "responseMimeType": response_mime_type,
        }

    endpoint = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{_model_name()}:generateContent?key={key}"
    )
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(request, timeout=25, context=ssl_context) as response:
        data = json.loads(response.read().decode("utf-8"))

    try:
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Gemini returned an empty response") from exc


def _generate_content_rest(parts: list[dict[str, Any]], response_mime_type: str | None = None) -> str:
    return _with_retries(
        lambda: _generate_content_rest_once(parts, response_mime_type),
        "REST",
    )


def _generate_content_sdk(parts: list[dict[str, Any]], response_mime_type: str | None = None) -> str:
    key = _api_key()
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=key)
    sdk_parts = []
    for part in parts:
        if "text" in part:
            sdk_parts.append(types.Part.from_text(text=part["text"]))
        elif "inline_data" in part:
            inline_data = part["inline_data"]
            sdk_parts.append(types.Part.from_bytes(
                data=base64.b64decode(inline_data["data"]),
                mime_type=inline_data["mime_type"],
            ))
    config = None
    if response_mime_type:
        config = types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type=response_mime_type,
        )
    response = client.models.generate_content(
        model=_model_name(),
        contents=[types.Content(role="user", parts=sdk_parts)],
        config=config,
    )
    text = getattr(response, "text", None)
    if not text:
        raise RuntimeError("Gemini returned an empty response")
    return text.strip()


def _generate_content(parts: list[dict[str, Any]], response_mime_type: str | None = None) -> str:
    """Use the official SDK when its runtime is available, with REST fallback."""
    key = _api_key()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    try:
        return _with_retries(
            lambda: _generate_content_sdk(parts, response_mime_type),
            "SDK",
        )
    except DailyLimitReachedError:
        raise
    except Exception as exc:
        if _is_daily_quota_exhausted(exc):
            raise DailyLimitReachedError from None
        logger.warning("Gemini SDK request failed; using official REST fallback: %s", exc)
        return _generate_content_rest(parts, response_mime_type)


def generate_chat_reply(messages: Iterable[Message], current_text: str, media: Iterable[Media] = ()) -> str:
    history = list(messages)
    media_list = list(media)
    unsupported_media = [item for item in media_list if item.media_type in {Media.MEDIA_AUDIO, Media.MEDIA_VIDEO}]
    image_media = [item for item in media_list if item.media_type == Media.MEDIA_IMAGE]
    unsupported_response = (
        "I can store audio and video files, but I cannot analyze those media types yet. "
        "Please upload an image or describe the sound/video in text."
    )
    if unsupported_media and not image_media:
        return unsupported_response
    deterministic = deterministic_reply(current_text)
    if _is_non_automotive_query(current_text) or re.fullmatch(
        r"(?:hi|hello|hey|howdy|good morning|good afternoon|good evening)[!. ]*",
        current_text.lower().strip(),
    ):
        return deterministic or "I can help with vehicle diagnostics and repair guidance."
    if deterministic is not None:
        return deterministic

    media_names = ", ".join(item.file.name for item in media_list if item.file.name) or "none"
    unsupported_note = ""
    if unsupported_media:
        unsupported_note = (
            " Audio and video files are stored but cannot currently be analyzed. "
            "Ask the customer to upload an image or describe the sound/video in text."
        )
    prompt = f"""You are a senior automobile technician helping a real customer in Delhi NCR.
You are the primary reasoning engine, not a fixed questionnaire. Determine the customer's actual automotive problem from the latest message and conversation history; never assume a category from an older turn. Match the customer's language naturally, including Hindi/Hinglish. Acknowledge the actual symptom, ask only one or two useful next questions, and do not repeat answered questions. If the situation is safety-critical (brake failure, detached wheel, steering failure, fuel leak, smoke/fire, severe overheating, dangerous tyre damage, or major accident), prioritize stopping safely, not driving, towing, and professional inspection. Ask for a photo only when visual evidence would help. If an image is supplied, describe only what is visibly identifiable and distinguish observations, possibilities, and uncertainty. When enough evidence exists, give a concise assessment, possible causes, the most likely explanation with uncertainty, next steps, and whether a mechanic is recommended. Do not invent vehicle specifications, prices, availability, bookings, or human identity. Do not answer unrelated questions except to explain the automotive scope. Keep the response under 180 words and use plain text.

Recent conversation:
{_history_text(messages)}

Current user message:
{current_text}

Uploaded media filenames: {media_names}
{unsupported_note}
"""
    try:
        response = _generate_content([{"text": prompt}, *_image_parts(media_list)])
        return f"{unsupported_response}\n\n{response}" if unsupported_media else response
    except DailyLimitReachedError:
        raise
    except Exception:
        logger.exception("Gemini chat generation failed")
        return _fallback_chat_reply(current_text, history)


def _fallback_diagnosis(messages: Iterable[Message]) -> dict[str, str]:
    text = " ".join(message.content for message in messages if message.content)
    normalized = text.lower()
    high_risk_terms = (
        "brake failure", "brakes failed", "brake not working", "steering failure",
        "steering failed", "detached wheel", "wheel came off", "tyre came off",
        "tire came off", "fuel leak", "petrol leak", "diesel leak", "smoke",
        "fire", "severe overheating", "overheating", "steam", "dangerous tyre",
        "dangerous tire", "flashing", "red", "grinding",
    )
    urgency = "high" if any(term in normalized for term in high_risk_terms) else "medium"
    likely_issue = "Possible brake, electrical, cooling, or mechanical fault"
    if "brake" in normalized or "squeal" in normalized:
        likely_issue = "Possible brake friction or rotor issue"
    elif "overheat" in normalized or "coolant" in normalized:
        likely_issue = "Possible cooling-system fault"
    elif "battery" in normalized or "no start" in normalized:
        likely_issue = "Possible battery or starting-system fault"
    return {
        "problem_summary": text or "Vehicle issue reported by user.",
        "possible_causes": "Worn component, loose connection, fluid issue, or sensor fault; inspection is required to distinguish them.",
        "most_likely_issue": likely_issue,
        "recommended_service": "Inspect the vehicle and perform a diagnostic scan before replacing parts.",
        "urgency": urgency,
    }


def _parse_diagnosis(text: str) -> dict[str, str]:
    cleaned = text.strip().removeprefix("```json").removesuffix("```").strip()
    data = json.loads(cleaned)
    required = ("problem_summary", "possible_causes", "most_likely_issue", "recommended_service", "urgency")
    if any(not isinstance(data.get(key), str) or not data[key].strip() for key in required):
        raise ValueError("Gemini diagnosis omitted required fields")
    if data["urgency"] not in {"low", "medium", "high"}:
        data["urgency"] = "medium"
    return {key: data[key].strip() for key in required}


def generate_diagnosis(messages: Iterable[Message], image_media: Iterable[Media] = ()) -> dict[str, str]:
    message_list = list(messages)
    fallback = _fallback_diagnosis(message_list)
    prompt = f"""You are a senior automobile technician in Delhi NCR preparing a cautious preliminary diagnosis.
Use only the evidence in the conversation and attached image. Match the user's language where practical. Do not claim certainty, invent vehicle details or prices, or create a booking. For dangerous symptoms such as brake failure, smoke, fuel leak, severe overheating, or steering failure, set urgency to high and recommend not driving/towing. Return ONLY valid JSON with exactly these string keys: problem_summary, possible_causes, most_likely_issue, recommended_service, urgency. urgency must be one of low, medium, high. Keep each value concise.

Conversation:
{_history_text(message_list)}
"""
    contents: list[dict[str, Any]] = [{"text": prompt}]
    try:
        contents.extend(_image_parts(image_media))
        return _parse_diagnosis(_generate_content(contents, "application/json"))
    except Exception:
        logger.exception("Gemini diagnosis generation failed")
        return fallback
