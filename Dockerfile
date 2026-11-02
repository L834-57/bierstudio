# Bierstudio – schlankes Image, nur Python-Standardbibliothek
FROM python:3.13-alpine

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000 \
    DATA_DIR=/data \
    TZ=Europe/Berlin

# Startet als root, übernimmt /data für PUID:PGID und gibt die Rechte dann ab (siehe drop_privileges in server.py).
# So muss niemand vorher chown ausführen. Eigener Benutzer statt des gemeinsamen "apps"-Benutzers von TrueNAS.
ENV PUID=3100 \
    PGID=3100
RUN apk add --no-cache tzdata && mkdir -p /data

WORKDIR /app
COPY app/ /app/

EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["python", "-u", "server.py"]
