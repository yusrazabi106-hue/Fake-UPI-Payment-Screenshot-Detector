import io
import re
import sqlite3
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

DB_PATH = Path(__file__).with_name("upi_shield.db")

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS seen_transactions (
            transaction_id TEXT PRIMARY KEY,
            first_seen TEXT NOT NULL
        )""")

def extract_text(image_bytes):
    """OCR is optional at runtime; install EasyOCR to enable it."""
    try:
        import easyocr
        if not hasattr(extract_text, "reader"):
            extract_text.reader = easyocr.Reader(["en"], gpu=False)
        arr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        results = extract_text.reader.readtext(image)
        return "\n".join(item[1] for item in results)
    except ImportError:
        return ""
    except Exception:
        return ""

def parse_fields(text):
    flat = " ".join(text.split())
    amount_match = re.search(r'(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.\d{1,2})?)', flat, re.I)
    txn_match = re.search(r'(?:UPI\s*(?:Ref(?:erence)?|ID)|Txn(?:\s*ID)?|Transaction\s*ID|Ref(?:erence)?\s*No\.?)\s*[:#-]?\s*([A-Z0-9]{8,30})', flat, re.I)
    time_match = re.search(r'\b(\d{1,2}:\d{2}(?:\s?[AP]M)?)\b', flat, re.I)
    date_match = re.search(r'\b(\d{1,2}[-/ ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ]\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b', flat, re.I)
    app = "Unknown"
    low = flat.lower()
    if "phonepe" in low: app = "PhonePe (text match)"
    elif "google pay" in low or "gpay" in low: app = "Google Pay (text match)"
    elif "paytm" in low: app = "Paytm (text match)"
    return {
        "amount": f"₹{amount_match.group(1)}" if amount_match else None,
        "transaction_id": txn_match.group(1) if txn_match else None,
        "timestamp": " ".join(x for x in [date_match.group(1) if date_match else "", time_match.group(1) if time_match else ""]).strip() or None,
        "app": app
    }

def check_duplicate(txn_id):
    if not txn_id:
        return None
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT first_seen FROM seen_transactions WHERE transaction_id=?", (txn_id,)).fetchone()
        if row:
            return row[0]
        conn.execute("INSERT OR IGNORE INTO seen_transactions VALUES (?,?)", (txn_id, datetime.now(timezone.utc).isoformat()))
    return None

def analyse_image(image_bytes):
    try:
        pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise ValueError("The uploaded file is not a readable image.")
    width, height = pil.size
    if width < 150 or height < 150:
        raise ValueError("Image is too small to inspect reliably.")

    arr = np.array(pil)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    file_hash = hashlib.sha256(image_bytes).hexdigest()
    text = extract_text(image_bytes)
    fields = parse_fields(text)

    checks, reasons = [], []
    checks.append({"name":"Image readability","detail":f"Decoded successfully ({width} × {height}px)."})
    checks.append({"name":"OCR extraction","detail":f"{len(text)} characters extracted." if text else "No OCR text extracted. Install EasyOCR and its model dependencies."})
    checks.append({"name":"Image sharpness","detail":f"Laplacian variance {lap_var:.1f}; this is a basic image-quality signal, not proof of editing."})

    if width < 300 or height < 400:
        reasons.append("Screenshot dimensions are unusually small for many payment receipt screens.")
    if not text:
        reasons.append("No readable payment text was extracted; manual review is required.")
    if fields["transaction_id"]:
        duplicate = check_duplicate(fields["transaction_id"])
        if duplicate:
            reasons.append("Transaction reference was already seen by this local prototype.")
            checks.append({"name":"Duplicate reference","detail":"Reference matches a previously analysed image in this local database."})
        else:
            checks.append({"name":"Duplicate reference","detail":"Not previously seen in this local database (this does not prove validity)."})
    else:
        checks.append({"name":"Transaction reference","detail":"No transaction/reference ID confidently extracted."})
        reasons.append("Transaction reference could not be confidently extracted.")
    if fields["amount"]:
        checks.append({"name":"Amount field","detail":f"Possible amount extracted: {fields['amount']}."})
    else:
        reasons.append("No recognizable payment amount was extracted.")
    if fields["timestamp"]:
        checks.append({"name":"Timestamp field","detail":f"Possible timestamp extracted: {fields['timestamp']}."})
    else:
        reasons.append("No recognizable date/time was extracted.")

    # Conservative verdict: only explicit duplicate reference produces SUSPICIOUS.
    # Other incomplete signals produce NEEDS_REVIEW, never a false "REAL" claim.
    duplicate_flag = any("already seen" in r.lower() for r in reasons)
    if duplicate_flag:
        verdict = "SUSPICIOUS"
        summary = "A transaction reference matches one previously analysed by this local prototype. This is a warning that needs investigation."
    elif not text or not fields["transaction_id"] or not fields["amount"] or not fields["timestamp"]:
        verdict = "NEEDS_REVIEW"
        summary = "The prototype could not confidently validate all expected fields. Review the screenshot and confirm the payment in the recipient's bank or payment app."
    else:
        verdict = "NEEDS_REVIEW"
        summary = "Basic fields were extracted, but screenshot appearance alone cannot establish that a payment is genuine or received."

    return {
        "verdict": verdict,
        "summary": summary,
        "extracted": fields,
        "checks": checks,
        "reasons": reasons,
        "ocr_text": text[:5000],
        "image": {"width": width, "height": height, "sha256_prefix": file_hash[:16], "sharpness_score": round(lap_var, 2)},
        "disclaimer": "Prototype limitation: this version does not yet compare against verified per-app reference templates or bank/payment-provider records. A clean screenshot is NOT proof of payment. Confirm the credit in the merchant account."
    }
