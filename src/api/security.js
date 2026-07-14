const crypto = require("node:crypto");

const BASE_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self' https://api.paceman.gg https://*.supabase.co https://*.posthog.com https://runalert.app",
  "form-action 'self'",
].join("; ");

function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": BASE_CSP,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Permitted-Cross-Domain-Policies": "none",
  });
  if (
    req.secure ||
    String(req.get("x-forwarded-proto") || "").toLowerCase() === "https"
  ) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

function createRequestLogger({ logger = console, now = Date.now } = {}) {
  return function requestLogger(req, res, next) {
    if (!logger || typeof logger.info !== "function") return next();
    const startedAt = now();
    const requestPath = req.path;
    const requestId = crypto.randomUUID();
    res.set("X-Request-Id", requestId);
    res.once("finish", () => {
      logger.info?.(
        "http_request",
        "path",
        requestPath,
        "method",
        req.method,
        "status",
        res.statusCode,
        "durationMs",
        Math.max(0, now() - startedAt),
        "requestId",
        requestId
      );
    });
    next();
  };
}

function createRateLimiter({
  windowMs = 60_000,
  max = 60,
  now = Date.now,
  clientAddress = (req) => req.ip || req.socket?.remoteAddress || "unknown",
} = {}) {
  const buckets = new Map();

  return function rateLimiter(req, res, next) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return next();
    }
    const timestamp = now();
    const routeGroup = req.path.startsWith("/api/pair/")
      ? "/api/pair"
      : req.path;
    const key = `${clientAddress(req)}:${routeGroup}`;
    let bucket = buckets.get(key);
    if (!bucket || timestamp >= bucket.resetAt) {
      bucket = { count: 0, resetAt: timestamp + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.set({
      "RateLimit-Limit": String(max),
      "RateLimit-Remaining": String(remaining),
      "RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1000)),
    });
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "rate_limit_exceeded",
        retryAfter,
      });
    }
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (timestamp >= value.resetAt) buckets.delete(bucketKey);
      }
    }
    return next();
  };
}

function apiErrorHandler(error, _req, res, next) {
  if (res.headersSent) return next(error);
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "request_too_large" });
  }
  if (error?.type === "entity.parse.failed" || error instanceof SyntaxError) {
    return res.status(400).json({ error: "invalid_json" });
  }
  return next(error);
}

module.exports = {
  BASE_CSP,
  apiErrorHandler,
  createRateLimiter,
  createRequestLogger,
  securityHeaders,
};
