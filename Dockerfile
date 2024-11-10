ARG DENO_VERSION=2.0.4
ARG BIN_IMAGE=denoland/deno:bin-${DENO_VERSION}
FROM ${BIN_IMAGE} AS bin

FROM frolvlad/alpine-glibc:alpine-3.13

RUN apk --no-cache add ca-certificates tzdata

RUN addgroup --gid 1000 deno \
    && adduser --uid 1000 --disabled-password deno --ingroup deno \
    && mkdir /app \
    && mkdir -p /app/cache \
    && mkdir -p /app/tmp \
    && chown -R deno:deno /app

# Set environment variables
ENV DENO_DIR=/app/cache
ENV DENO_INSTALL_ROOT=/usr/local
ENV TMP=/app/tmp
ENV TMPDIR=/app/tmp
ENV TEMP=/app/tmp
ENV TZ=UTC

ARG DENO_VERSION
ENV DENO_VERSION=${DENO_VERSION}
COPY --from=bin /deno /bin/deno

WORKDIR /app

# Copy application files
COPY . .

RUN ls -la /app && \
    ls -la /app/static && \
    ls -la /app/static/styles && \
    ls -la /app/static/scripts

# Ensure deno user owns all files and directories
RUN chown -R deno:deno /app

# Switch to deno user for security
USER deno

# Cache the dependencies with all required permissions
RUN deno cache --reload main.ts

# Run the application with necessary permissions
ENTRYPOINT ["/bin/deno"]
CMD ["run", \
    "--allow-net", \
    "--allow-env", \
    "--allow-read=/app", \
    "--allow-write=/app/tmp", \
    "--allow-read=/app/cache", \
    "--allow-write=/app/cache", \
    "--allow-hrtime", \
    "main.ts"]
