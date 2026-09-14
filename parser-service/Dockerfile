# Deliberately minimal — this service has no outbound network needs.
# See docs/security/assessment.md Section 11: deploy this container
# with egress/outbound network access blocked at the infrastructure
# level (e.g. a network policy or the hosting platform's egress
# controls). It only needs to (a) accept inbound requests from the
# Next.js backend and (b) return a response — it never needs to call
# out to anything else, which is what closes off SSRF entirely.

FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py parser.py ./

# Runs as a non-root user — defense in depth even though this service
# has a small attack surface by design.
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
