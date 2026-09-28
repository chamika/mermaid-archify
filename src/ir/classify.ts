import { SEMANTIC_TYPES, type SemanticType } from './types';

/** Explicit class aliases users may write as `A:::db` or `class A queue`. */
const CLASS_ALIASES: Record<string, SemanticType> = {
  db: 'database',
  store: 'database',
  storage: 'database',
  queue: 'messagebus',
  bus: 'messagebus',
  events: 'messagebus',
  client: 'frontend',
  ui: 'frontend',
  service: 'backend',
  api: 'backend',
  infra: 'cloud',
  auth: 'security',
  thirdparty: 'external',
};

/** Architecture-beta built-in icons (plus common iconify-style names). */
const ICONS: Record<string, SemanticType> = {
  database: 'database',
  disk: 'database',
  server: 'backend',
  cloud: 'cloud',
  internet: 'external',
};

/** Flowchart shapes that carry meaning on their own. */
const SHAPES: Record<string, SemanticType> = {
  cylinder: 'database',
  subroutine: 'backend',
  doublecircle: 'external',
  circle: 'external',
};

/** Ordered: the first matching rule wins. Matched against whole words. */
const KEYWORDS: [RegExp, SemanticType][] = [
  [/\b(auth\w*|iam|oauth|oidc|sso|waf|firewall|vault|kms|secrets?|identity|idp|keycloak|cognito|okta|guard|policy|login)\b/i, 'security'],
  [/\b(kafka|queues?|sqs|sns|rabbit\w*|pub\/?sub|nats|kinesis|event ?bus|eventbridge|stream\w*|topics?|broker|mq|celery|bull)\b/i, 'messagebus'],
  [/\b(db|database|postgres\w*|pg|mysql|maria\w*|mongo\w*|redis|cache|dynamo\w*|cassandra|sqlite|sql|warehouse|lake|bigquery|snowflake|s3|bucket|blob|storage|elastic\w*|opensearch|index|store|ledger|disk)\b/i, 'database'],
  [/\b(ui|web|web ?app|frontend|browser|mobile|ios|android|app|client|spa|react|next\.?js|vue|user|users|customer|admin|portal|dashboard|console)\b/i, 'frontend'],
  [/\b(cdn|cloudfront|aws|gcp|azure|lambda|k8s|kubernetes|cluster|vpc|region|load ?balancer|lb|alb|elb|nginx|gateway|ingress|dns|edge)\b/i, 'cloud'],
  [/\b(stripe|paypal|twilio|sendgrid|github|slack|third[- ]?party|external|partner|vendor|saas|openai|anthropic|claude|llm|email|smtp|webhook)\b/i, 'external'],
];

export interface ClassifyInput {
  label: string;
  id: string;
  classes?: string[];
  /** Architecture icon or flowchart shape name. */
  icon?: string;
  shape?: string;
}

export function classify({ label, id, classes = [], icon, shape }: ClassifyInput): SemanticType {
  for (const c of classes) {
    const k = c.toLowerCase();
    if ((SEMANTIC_TYPES as readonly string[]).includes(k)) return k as SemanticType;
    if (CLASS_ALIASES[k]) return CLASS_ALIASES[k];
  }
  if (icon) {
    const k = icon.toLowerCase().split(':').pop()!;
    if (ICONS[k]) return ICONS[k];
    const byIcon = byKeyword(k);
    if (byIcon) return byIcon;
  }
  if (shape && SHAPES[shape]) return SHAPES[shape];
  return byKeyword(label) ?? byKeyword(id.replace(/[_-]+/g, ' ')) ?? 'backend';
}

function byKeyword(text: string): SemanticType | undefined {
  for (const [re, type] of KEYWORDS) if (re.test(text)) return type;
  return undefined;
}
