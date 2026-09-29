import { type Certainty, type IRNode, SEMANTIC_TYPES, type SemanticType } from './types';

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

/**
 * Flowchart shapes that state a component kind on their own. Only storage
 * qualifies: a subroutine or circle means something different in a process
 * flow than in an architecture map.
 */
const SHAPES: Record<string, SemanticType> = {
  cylinder: 'database',
};

/** Ordered: the first matching rule wins. Matched against whole words. */
const KEYWORDS: [RegExp, SemanticType][] = [
  [/\b(auth\w*|iam|oauth|oidc|sso|waf|firewall|vault|kms|secrets?|identity|idp|keycloak|cognito|okta|guard|policy|login)\b/i, 'security'],
  [/\b(kafka|queues?|sqs|sns|rabbit\w*|pub\/?sub|nats|kinesis|event ?bus|eventbridge|stream\w*|topics?|broker|mq|celery|bull)\b/i, 'messagebus'],
  [/\b(db|database|postgres\w*|pg|mysql|maria\w*|mongo\w*|redis|cache|dynamo\w*|cassandra|sqlite|sql|warehouse|lake|bigquery|snowflake|s3|bucket|blob|storage|datastore|data ?store|elastic\w*|opensearch|index|store|ledger|disk)\b/i, 'database'],
  [/\b(ui|web|web ?app|frontend|browser|mobile|ios|android|app|client|spa|react|next\.?js|vue|user|users|customer|admin|portal|dashboard|console)\b/i, 'frontend'],
  [/\b(cdn|cloudfront|aws|gcp|azure|lambda|k8s|kubernetes|cluster|vpc|region|load ?balancer|lb|alb|elb|nginx|gateway|ingress|dns|edge)\b/i, 'cloud'],
  [/\b(stripe|paypal|twilio|sendgrid|github|slack|third[- ]?party|external|partner|vendor|saas|openai|anthropic|claude|llm|email|smtp|webhook)\b/i, 'external'],
  [/\b(api|apis|service|services|server|backend|worker|workers|microservices?|daemon|scheduler|cron|processor)\b/i, 'backend'],
];

export interface ClassifyInput {
  label: string;
  id: string;
  classes?: string[];
  /** Architecture icon or flowchart shape name. */
  icon?: string;
  shape?: string;
}

export interface Classification {
  type: SemanticType;
  certainty: Certainty;
}

/**
 * Decide a node's component type and how sure we are. Explicit evidence
 * (a class, an icon, a storage shape) is always shown; a keyword match is only
 * a guess, and `settleTypes` keeps guesses only in architecture-like diagrams.
 */
export function classify({ label, id, classes = [], icon, shape }: ClassifyInput): Classification {
  for (const c of classes) {
    const k = c.toLowerCase();
    if ((SEMANTIC_TYPES as readonly string[]).includes(k)) return { type: k as SemanticType, certainty: 'explicit' };
    if (CLASS_ALIASES[k]) return { type: CLASS_ALIASES[k], certainty: 'explicit' };
  }
  if (icon) {
    const k = icon.toLowerCase().split(':').pop()!;
    if (ICONS[k]) return { type: ICONS[k], certainty: 'explicit' };
    const byIcon = byKeyword(k);
    if (byIcon) return { type: byIcon, certainty: 'explicit' };
  }
  if (shape && SHAPES[shape]) return { type: SHAPES[shape], certainty: 'explicit' };
  const guess = byKeyword(label) ?? byKeyword(id.replace(/[_-]+/g, ' '));
  return guess ? { type: guess, certainty: 'guess' } : { type: 'plain', certainty: 'none' };
}

function byKeyword(text: string): SemanticType | undefined {
  for (const [re, type] of KEYWORDS) if (re.test(text)) return type;
  return undefined;
}

/** Spread into an IRNode: the type plus how it was decided. */
export const typed = ({ type, certainty }: Classification) => ({ type, certainty });

/** Pseudo nodes that never carry a component type. */
const STRUCTURAL = new Set(['start', 'end', 'junction', 'fork', 'note', 'text']);

/**
 * Keyword guesses are only trustworthy when the diagram as a whole reads as a
 * component map: at least half of its content nodes are typed by evidence or
 * by keyword. Otherwise (a process flow such as "Christmas → Go shopping") the
 * guesses are dropped and those nodes render plain, as in Mermaid.
 */
export function settleTypes(nodes: IRNode[]): void {
  const content = nodes.filter((n) => !STRUCTURAL.has(n.shape));
  const typed = content.filter((n) => n.certainty === 'explicit' || n.certainty === 'guess').length;
  const architectural = content.length > 0 && typed * 2 >= content.length;
  if (architectural) return;
  for (const n of content) {
    if (n.certainty === 'guess') {
      n.type = 'plain';
      n.certainty = 'none';
    }
  }
}
