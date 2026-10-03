# Start from a small official Python image
FROM python:3.11-slim

# Run as a normal user instead of root (safer)
RUN useradd -m -u 1000 user
USER user

# Make sure programs installed with pip can be found
ENV PATH="/home/user/.local/bin:$PATH"

# All our app files will live in /app inside the container
WORKDIR /app

# Copy requirements first and install them (Docker caches this step, so rebuilds are faster)
COPY --chown=user requirements.txt requirements.txt
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Download Sinéad's speaking voice once, now, at build time — not on every request or every
# time the free-tier server wakes back up. Piper (piper-tts) needs no extra system packages:
# espeak-ng is compiled directly into the Python package. See tts.py for how it is used.
RUN python -m piper.download_voices en_GB-alba-medium --download-dir voices

# Copy the rest of the project into the container
COPY --chown=user . /app

# Start the web server. Render tells us which port to use through the PORT
# variable; if it is missing (for example on your laptop) we fall back to 10000.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
