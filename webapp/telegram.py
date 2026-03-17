"""Telegram Bot notifications for DockSense."""

import logging
import os

import requests

log = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
APP_URL = os.environ.get("APP_URL", "https://smart-commute-imperial-0cac549c4dd9.herokuapp.com")


def is_configured():
    """Check if Telegram credentials are set."""
    return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)


def send_message(text, chat_id=None, parse_mode="HTML"):
    """Send a Telegram message via the Bot API.

    Returns True on success, False on failure.
    """
    if not TELEGRAM_BOT_TOKEN:
        log.warning("TELEGRAM_BOT_TOKEN not set, skipping message")
        return False

    target = chat_id or TELEGRAM_CHAT_ID
    if not target:
        log.warning("No chat_id provided and TELEGRAM_CHAT_ID not set")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        resp = requests.post(url, json={
            "chat_id": target,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True,
        }, timeout=10)
        resp.raise_for_status()
        return True
    except Exception as e:
        log.error("Telegram send failed: %s", e)
        return False


def format_dock_alert(prediction):
    """Format a DockSense prediction into a Telegram notification.

    Args:
        prediction: dict matching /api/prediction/now response shape

    Returns:
        HTML-formatted message string.
    """
    rec = prediction.get("recommended")
    weather = prediction.get("weather", {})
    stations = prediction.get("stations", [])

    if not rec:
        return (
            "<b>DockSense</b>\n\n"
            "All stations predicted full. Leave as early as possible.\n\n"
            f'<a href="{APP_URL}/?mode=now">Open in DockSense</a>'
        )

    short_name = rec["station_name"].split(",")[0]
    docks = rec["predicted_empty_docks"]
    confidence = round(rec.get("confidence", 0) * 100)
    walk_min = rec.get("walk_to_destination_min", 0)
    total_min = rec.get("total_trip_min", 0)

    # Find full stations for warning
    full_stations = [s for s in stations if s.get("predicted_empty_docks", 0) == 0]
    full_names = [s["station_name"].split(",")[0] for s in full_stations[:3]]

    lines = [
        "<b>DockSense Morning</b>",
        "",
        f"Go to: <b>{short_name}</b>",
        f"Predicted empty docks: {docks} ({confidence}% confidence)",
        f"Total trip: ~{total_min} min (walk {walk_min} min to uni)",
    ]

    if full_names:
        lines.append("")
        lines.append(f"Full: {', '.join(full_names)}")

    if weather.get("temperature") is not None:
        lines.append(f"Weather: {weather['temperature']}\u00B0C, {weather.get('description', '')}")

    lines.append("")
    lines.append(f'<a href="{APP_URL}/?mode=now">Open in DockSense</a>')

    return "\n".join(lines)


def send_dock_alert(prediction, chat_id=None):
    """Format and send a dock availability notification.

    Returns True on success.
    """
    text = format_dock_alert(prediction)
    return send_message(text, chat_id=chat_id)
