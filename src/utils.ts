import fs from "fs";
import path from "path";
import crypto from "node:crypto";

export function deriveSessionId(projectDir: string): string {
  const hash = crypto.createHash("sha256").update(projectDir).digest("hex");
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

interface PendingItem {
  id: string;
  timestamp?: string;
  receivedAt?: string;
  description?: string;
  element?: { selector?: string };
  screenshot?: string;
  [key: string]: unknown;
}

interface PendingSummary {
  count: number;
  items: { id: string; timestamp: string | undefined; description: string; selector: string }[];
}

export function getPendingSummary(pending: PendingItem[] | unknown): PendingSummary {
  const items = Array.isArray(pending) ? pending : [];
  return {
    count: items.length,
    items: items.map((f: PendingItem) => ({
      id: f.id,
      timestamp: f.timestamp || f.receivedAt,
      description: f.description ? f.description.slice(0, 100) : "",
      selector: f.element?.selector || "",
    })),
  };
}

interface DetectionStrategy {
  file: string;
  patterns: RegExp[];
  transform: (match: RegExpMatchArray) => string;
}

interface DetectionResult {
  url: string | null;
  detectedFrom: string | null;
}

function ensureUrl(value: string): string {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return `https://${value}`;
  }
  return value;
}

export function detectProjectUrl(projectDir: string): DetectionResult {
  const detectionStrategies: DetectionStrategy[] = [
    {
      file: ".env",
      patterns: [
        /^(?:APP_URL|BASE_URL|SITE_URL|PROJECT_URL|HOSTNAME)=["']?([^"'\s]+)["']?/m,
        /^(?:VIRTUAL_HOST|COMPOSE_DOMAIN)=["']?([^"'\s]+)["']?/m,
      ],
      transform: (match) => ensureUrl(match[1]),
    },
    {
      file: ".env.local",
      patterns: [
        /^(?:APP_URL|BASE_URL|SITE_URL|PROJECT_URL|HOSTNAME)=["']?([^"'\s]+)["']?/m,
        /^(?:VIRTUAL_HOST|COMPOSE_DOMAIN)=["']?([^"'\s]+)["']?/m,
      ],
      transform: (match) => ensureUrl(match[1]),
    },
    {
      file: "docker-compose.yml",
      patterns: [
        /VIRTUAL_HOST[=:]\s*["']?([^"'\s]+)["']?/,
        /traefik\.http\.routers\.[^.]+\.rule[=:]\s*["']?Host\(`([^`]+)`\)["']?/,
      ],
      transform: (match) => ensureUrl(match[1]),
    },
    {
      file: "docker-compose.override.yml",
      patterns: [
        /VIRTUAL_HOST[=:]\s*["']?([^"'\s]+)["']?/,
        /traefik\.http\.routers\.[^.]+\.rule[=:]\s*["']?Host\(`([^`]+)`\)["']?/,
      ],
      transform: (match) => ensureUrl(match[1]),
    },
    {
      file: "package.json",
      patterns: [/"homepage"\s*:\s*"([^"]+)"/, /"proxy"\s*:\s*"([^"]+)"/],
      transform: (match) => match[1],
    },
  ];

  for (const strategy of detectionStrategies) {
    const filePath = path.join(projectDir, strategy.file);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        for (const pattern of strategy.patterns) {
          const match = content.match(pattern);
          if (match) {
            return {
              url: strategy.transform(match),
              detectedFrom: strategy.file,
            };
          }
        }
      } catch {
        // Continue to next strategy
      }
    }
  }

  return { url: null, detectedFrom: null };
}

