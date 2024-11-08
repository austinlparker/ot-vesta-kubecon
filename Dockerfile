ARG DENO_VERSION=2.0.4
ARG BIN_IMAGE=denoland/deno:bin-${DENO_VERSION}
FROM ${BIN_IMAGE} AS bin

FROM frolvlad/alpine-glibc:alpine-3.13

RUN apk --no-cache add ca-certificates

RUN addgroup --gid 1000 deno \
    && adduser --uid 1000 --disabled-password deno --ingroup deno \
    && mkdir /app \
    && chown deno:deno /app

ENV DENO_DIR /app/cache
ENV DENO_INSTALL_ROOT /usr/local

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

# Ensure deno user owns all files
RUN chown -R deno:deno /app

# Switch to deno user for security
USER deno

# Cache the dependencies
RUN deno cache main.ts

# Run the application
ENTRYPOINT ["/bin/deno"]
CMD ["run", "--allow-net", "--allow-env", "--allow-read=/app/static", "main.ts"]
