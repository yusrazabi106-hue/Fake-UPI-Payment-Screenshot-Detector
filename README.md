# UPI Shield — Full-stack MVP

A responsive dark-theme frontend plus a FastAPI backend for OCR-assisted inspection of UPI payment screenshots.

## Project structure
- `frontend/index.html` — dashboard, upload, results, activity and about sections
- `frontend/style.css` — responsive dark fintech styling
- `frontend/script.js` — upload/camera/drag-drop, API calls, results and local history
- `backend/main.py` — FastAPI endpoints
- `backend/detector.py` — OCR extraction, field parsing and basic heuristic checks
- `backend/requirements.txt` — Python dependencies

## Run on Windows
1. Install Python 3.10 or newer.
2. Open this project folder in VS Code.
3. Open a terminal and run:
   ```powershell
   cd backend
   py -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   uvicorn main:app --reload
   ```
4. Keep that terminal running.
5. Open `frontend/index.html` with VS Code Live Server (or another local static server).
6. The frontend calls `http://127.0.0.1:8000`. API docs are at `http://127.0.0.1:8000/docs`.

EasyOCR may download model weights on first use, so first analysis can take longer and requires internet. The OCR dependency is CPU-capable but may be slow on a low-spec laptop.

## What currently works
- Upload JPG/PNG/WEBP up to 10 MB, drag-and-drop, and mobile camera input
- Preview and remove image
- FastAPI image upload endpoint
- Image decoding/dimensions and basic sharpness metric
- Optional EasyOCR text extraction
- Best-effort parsing of amount, transaction reference, app name and timestamp
- Local SQLite duplicate-reference check (only among screenshots analysed by this local instance)
- Results rendered in the website and browser-local recent activity

## Important limitations — read before demo
This is a functional MVP, **not a reliable payment authentication system**:
- It does not connect to bank accounts, UPI rails, PSP APIs or merchant statements.
- A screenshot cannot prove funds were received.
- OCR field extraction is best-effort and may miss or misread text.
- The duplicate check only compares IDs seen by this one local database; it is not a national UPI duplicate lookup.
- Current image checks are basic heuristics, not a trained tampering classifier.
- Per-app reference templates and a labelled genuine/fake dataset are still needed for meaningful layout/font/pixel comparison.
- A `NEEDS_REVIEW` result is not a declaration that the screenshot is genuine.
- Do not use this prototype to accept/reject real payments without independent payment confirmation.

## Before public deployment
Restrict CORS to the deployed frontend origin, add authentication/rate limiting, secure upload handling, privacy/retention controls, and use a persistent database. Do not expose the development API with unrestricted CORS.
