import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  getIdTokenResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, hasFirebaseConfig } from './firebase';
import { LOCAL_SWAPS_COLLECTION } from './config';
import adminLogo from './assets/flavormind-removebg-preview (3).png';

type RecipeDoc = {
  id: string;
  title?: string;
  description?: string;
  imageUrl?: string | null;
  image?: string | null;
  ownerName?: string;
  ownerId?: string;
  ownerEmail?: string;
  cuisine?: string;
  category?: string;
  difficulty?: string;
  cookTime?: number;
  prepTime?: number;
  servings?: number;
  ingredients?: Array<{
    name?: string;
    quantity?: string | number;
    qty?: string | number;
    unit?: string;
    note?: string;
  }>;
  instructions?: Array<
    | string
    | {
        step?: number;
        description?: string;
      }
  >;
  approvalStatus?: string;
  publishStatus?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type CookbookDoc = {
  id: string;
  title?: string;
  authorName?: string;
  ownerId?: string;
  ownerEmail?: string;
  coverImageUrl?: string | null;
  introImageUrl?: string | null;
  thankYouImageUrl?: string | null;
  introduction?: string;
  occupation?: string;
  aboutAuthor?: string;
  thankYouMessage?: string;
  categories?: string[];
  shareVisibility?: string;
  recipes?: Array<string | Record<string, unknown>>;
  recipesCount?: number;
  approvalStatus?: string;
  publishStatus?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type LocalSwapDoc = {
  id: string;
  data: Record<string, unknown>;
};

type ReviewTarget =
  | { type: 'recipe'; item: RecipeDoc }
  | { type: 'cookbook'; item: CookbookDoc }
  | { type: 'swap'; item: LocalSwapDoc };

type StatValue = number | null;

type HistoryItem = {
  id: string;
  type: 'recipe' | 'cookbook' | 'swap';
  title: string;
  author: string;
  status: 'approved' | 'rejected';
  date: unknown;
};

type NavItem = 'dashboard' | 'approvals' | 'history' | 'settings';

type IconProps = {
  d: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
};

const toMillis = (value?: unknown) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  if (typeof value === 'object') {
    const anyValue = value as { toMillis?: () => number; seconds?: number };
    if (typeof anyValue.toMillis === 'function') {
      return anyValue.toMillis();
    }
    if (typeof anyValue.seconds === 'number') {
      return anyValue.seconds * 1000;
    }
  }
  return 0;
};

const formatDate = (value?: unknown) => {
  if (!value) return '--';
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '--' : parsed.toLocaleDateString();
  }
  if (typeof value === 'object') {
    const anyValue = value as { toDate?: () => Date; toMillis?: () => number };
    if (typeof anyValue.toDate === 'function') {
      return anyValue.toDate().toLocaleDateString();
    }
    if (typeof anyValue.toMillis === 'function') {
      return new Date(anyValue.toMillis()).toLocaleDateString();
    }
  }
  return '--';
};

const pickCount = (primary: number | null, fallback: number | null) => {
  if (typeof primary === 'number' && primary > 0) return primary;
  if (typeof fallback === 'number') return fallback;
  return primary;
};

const extractString = (data: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const formatInlineValue = (value: unknown) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return '';
};

const pickImageUrl = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const formatIngredientLine = (value: unknown) => {
  if (typeof value === 'string') return value.trim();
  if (!isRecord(value)) return '';

  const name = extractString(value, ['name', 'ingredient', 'title']);
  const quantity = formatInlineValue(value.quantity ?? value.qty ?? value.amount);
  const unit = extractString(value, ['unit']);
  const note = extractString(value, ['note']);
  const base = [quantity, unit, name].filter(Boolean).join(' ').trim();

  if (!base && note) {
    return note;
  }

  return note ? `${base} (${note})` : base;
};

const formatTextList = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];

  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (!isRecord(item)) return '';
      return extractString(item, ['description', 'text', 'title', 'name']).trim();
    })
    .filter(Boolean);
};

const formatRecipeReference = (value: unknown) => {
  if (typeof value === 'string') return value.trim();
  if (!isRecord(value)) return '';

  return (
    extractString(value, ['title', 'name', 'recipeTitle'])
    || extractString(value, ['recipeId', 'id', 'externalId'])
  );
};

const extractRecipeReferenceId = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return '';
  return extractString(value, ['recipeId', 'id']);
};

const Icon = ({ d, size = 18, style = {}, className = '' }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    className={className}
  >
    <path d={d} />
  </svg>
);

const icons = {
  dashboard: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10',
  approvals: 'M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  history: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 5v5l4 2',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  chevL: 'M15 18l-6-6 6-6',
  chevR: 'M9 18l6-6-6-6',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 11a4 4 0 100-8 4 4 0 000 8z',
  book: 'M4 19.5A2.5 2.5 0 016.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
  swap: 'M7 16V4m0 0L3 8m4-4l4 4 M17 8v12m0 0l4-4m-4 4l-4-4',
  recipe: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M9 5a2 2 0 012-2h2a2 2 0 012 2',
  lock: 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z M7 11V7a5 5 0 0110 0v4',
  mail: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6',
};

type SparklineProps = {
  data: number[];
  color: string;
};

const Sparkline = ({ data, color }: SparklineProps) => {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const norm = (value: number) => 34 - ((value - min) / (max - min || 1)) * 30;
  const pts = data
    .map((value, index) => `${(index / (data.length - 1)) * 80},${norm(value)}`)
    .join(' ');

  return (
    <svg width="80" height="36" viewBox="0 0 80 36" fill="none">
      <polyline points={`0,36 ${pts} 80,36`} stroke="none" fill={color} opacity="0.12" />
      <polyline
        points={pts}
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
};

type DonutChartProps = {
  approved: number;
  rejected: number;
  pending: number;
};

const DonutChart = ({ approved, rejected, pending }: DonutChartProps) => {
  const total = approved + rejected + pending || 1;
  const radius = 28;
  const cx = 36;
  const cy = 36;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { value: approved, color: '#22c55e' },
    { value: rejected, color: '#ef4444' },
    { value: pending, color: '#f59e0b' },
  ];
  let offset = 0;

  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      {segments.map((segment, index) => {
        const dash = (segment.value / total) * circumference;
        const element = (
          <circle
            key={index}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="10"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 36 36)"
            opacity="0.9"
          />
        );
        offset += dash;
        return element;
      })}
      <circle cx={cx} cy={cy} r={20} fill="#161628" />
    </svg>
  );
};

type StatCardProps = {
  label: string;
  value: string;
  icon: string;
  color: string;
  spark?: number[];
  sub?: string;
};

const StatCard = ({ label, value, icon, color, spark, sub }: StatCardProps) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 p-5 flex flex-col gap-3">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
          {label}
        </p>
        <p className="mt-1 text-[30px] font-bold" style={{ color, fontFamily: 'DM Mono, monospace' }}>
          {value}
        </p>
        {sub ? <p className="mt-1 text-[11px] text-white/30">{sub}</p> : null}
      </div>
      <div className="rounded-xl p-2" style={{ background: `${color}18` }}>
        <Icon d={icon} size={17} style={{ color }} />
      </div>
    </div>
    {spark ? <Sparkline data={spark} color={color} /> : null}
  </div>
);

type ApprovalCardProps = {
  title: string;
  meta: string;
  author: string;
  email: string;
  submitted: string;
  onView: () => void;
  onApprove: () => void;
  onReject: () => void;
  loading?: boolean;
};

const ApprovalCard = ({
  title,
  meta,
  author,
  email,
  submitted,
  onView,
  onApprove,
  onReject,
  loading,
}: ApprovalCardProps) => {
  const initial = author?.trim()?.[0]?.toUpperCase() || '?';

  return (
    <div className="rounded-[14px] border border-white/10 bg-white/5 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className="truncate text-[15px] font-semibold text-white"
            style={{ fontFamily: 'DM Serif Display, serif' }}
          >
            {title}
          </p>
          <p className="mt-1 text-[12px] text-white/40">{meta}</p>
        </div>
        <span className="rounded-full bg-amber-500/10 px-2 py-[3px] text-[11px] font-semibold text-amber-400">
          Pending
        </span>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
        <div
          className="h-8 w-8 rounded-full text-sm font-semibold text-white flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#f97316,#ec4899)' }}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-white">{author}</p>
          <p className="text-[11px] text-white/40 truncate">{email}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-white/30">Submitted</p>
          <p className="text-[11px] text-white/70" style={{ fontFamily: 'DM Mono, monospace' }}>
            {submitted}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onView}
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] font-semibold text-white/80 transition hover:border-amber-400/50 hover:text-white"
      >
        View details
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={loading}
          className="flex-1 rounded-lg bg-emerald-500/90 px-2 py-2 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Icon d={icons.check} size={13} style={{ color: '#fff' }} /> Approve
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={loading}
          className="flex-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-[13px] font-semibold text-rose-400 flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Icon d={icons.x} size={13} style={{ color: '#ef4444' }} /> Reject
        </button>
      </div>
    </div>
  );
};

type DetailSectionProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

const DetailSection = ({ title, subtitle, children }: DetailSectionProps) => (
  <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
        {title}
      </p>
      {subtitle ? <p className="mt-1 text-sm text-white/45">{subtitle}</p> : null}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

type DetailFieldProps = {
  label: string;
  value?: string | null;
};

const DetailField = ({ label, value }: DetailFieldProps) => {
  if (!value) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#121221] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35">
        {label}
      </p>
      <p className="mt-1 text-sm text-white/85">{value}</p>
    </div>
  );
};

type BrandLogoProps = {
  size?: number;
  roundedClassName?: string;
  className?: string;
};

const BrandLogo = ({
  size = 48,
  roundedClassName = 'rounded-2xl',
  className = '',
}: BrandLogoProps) => (
  <div
    className={`shrink-0 overflow-hidden border border-white/10 bg-white/5 ${roundedClassName} ${className}`.trim()}
    style={{ width: size, height: size }}
  >
    <img src={adminLogo} alt="FlavorMind Admin" className="h-full w-full object-contain p-1" />
  </div>
);

function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authError, setAuthError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<NavItem>('dashboard');

  const [stats, setStats] = useState<{
    users: StatValue;
    recipes: StatValue;
    pendingRecipes: StatValue;
    approvedRecipes: StatValue;
    rejectedRecipes: StatValue;
    cookbooks: StatValue;
    pendingCookbooks: StatValue;
    approvedCookbooks: StatValue;
    rejectedCookbooks: StatValue;
    localSwaps: StatValue;
    pendingLocalSwaps: StatValue;
  }>({
    users: null,
    recipes: null,
    pendingRecipes: null,
    approvedRecipes: null,
    rejectedRecipes: null,
    cookbooks: null,
    pendingCookbooks: null,
    approvedCookbooks: null,
    rejectedCookbooks: null,
    localSwaps: null,
    pendingLocalSwaps: null,
  });
  const [pendingRecipes, setPendingRecipes] = useState<RecipeDoc[]>([]);
  const [pendingCookbooks, setPendingCookbooks] = useState<CookbookDoc[]>([]);
  const [localSwaps, setLocalSwaps] = useState<LocalSwapDoc[]>([]);
  const [localSwapError, setLocalSwapError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<ReviewTarget | null>(null);
  const [selectedCookbookRecipes, setSelectedCookbookRecipes] = useState<RecipeDoc[]>([]);
  const [selectedCookbookRecipesLoading, setSelectedCookbookRecipesLoading] = useState(false);
  const [selectedCookbookRecipesError, setSelectedCookbookRecipesError] = useState<string | null>(null);
  const [selectedGuideData, setSelectedGuideData] = useState<Record<string, unknown> | null>(null);
  const [selectedGuideLoading, setSelectedGuideLoading] = useState(false);
  const [selectedGuideError, setSelectedGuideError] = useState<string | null>(null);

  const [settingsName, setSettingsName] = useState('');
  const [settingsEmail, setSettingsEmail] = useState('');
  const [settingsPassword, setSettingsPassword] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    const activeAuth = auth;
    if (!hasFirebaseConfig || !activeAuth) {
      setAuthReady(true);
      return;
    }
    const unsubscribe = onAuthStateChanged(activeAuth, async (user) => {
      setAuthUser(user);
      setAuthReady(true);
      setAuthError('');
      if (!user) {
        setIsAdmin(false);
        return;
      }
      try {
        const tokenResult = await getIdTokenResult(user, true);
        if (tokenResult.claims.admin === true) {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
          await signOut(activeAuth);
          setAuthError('This account does not have admin access.');
        }
      } catch (error) {
        console.error('Admin claim check failed:', error);
        setIsAdmin(false);
        setAuthError('Unable to verify admin access.');
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    setSettingsName(authUser.displayName || '');
    setSettingsEmail(authUser.email || '');
  }, [authUser]);

  useEffect(() => {
    if (isAdmin) return;
    setSelectedSubmission(null);
  }, [isAdmin]);

  useEffect(() => {
    if (!selectedSubmission) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedSubmission(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [db, selectedSubmission]);

  useEffect(() => {
    let cancelled = false;

    const loadCookbookRecipes = async () => {
      const activeDb = db;

      if (!activeDb || !selectedSubmission || selectedSubmission.type !== 'cookbook') {
        setSelectedCookbookRecipes([]);
        setSelectedCookbookRecipesLoading(false);
        setSelectedCookbookRecipesError(null);
        return;
      }

      const recipeIds = (selectedSubmission.item.recipes || [])
        .map(extractRecipeReferenceId)
        .filter(Boolean);

      if (recipeIds.length === 0) {
        setSelectedCookbookRecipes([]);
        setSelectedCookbookRecipesLoading(false);
        setSelectedCookbookRecipesError(null);
        return;
      }

      setSelectedCookbookRecipesLoading(true);
      setSelectedCookbookRecipesError(null);

      try {
        const recipeSnapshots = await Promise.all(
          recipeIds.map((recipeId) => getDoc(doc(activeDb, 'recipes', recipeId)))
        );

        if (cancelled) return;

        const recipes = recipeSnapshots
          .filter((snapshot) => snapshot.exists())
          .map((snapshot) => ({
            id: snapshot.id,
            ...(snapshot.data() as Omit<RecipeDoc, 'id'>),
          }));

        setSelectedCookbookRecipes(recipes);
      } catch (error) {
        console.error('Cookbook recipe detail load error', error);
        if (!cancelled) {
          setSelectedCookbookRecipes([]);
          setSelectedCookbookRecipesError('Unable to load recipe details for this cookbook.');
        }
      } finally {
        if (!cancelled) {
          setSelectedCookbookRecipesLoading(false);
        }
      }
    };

    void loadCookbookRecipes();

    return () => {
      cancelled = true;
    };
  }, [db, selectedSubmission]);

  useEffect(() => {
    let cancelled = false;

    const loadGuideData = async () => {
      const activeDb = db;

      if (!selectedSubmission || selectedSubmission.type !== 'swap') {
        setSelectedGuideData(null);
        setSelectedGuideLoading(false);
        setSelectedGuideError(null);
        return;
      }

      const embeddedGuide = isRecord(selectedSubmission.item.data.guide)
        ? selectedSubmission.item.data.guide
        : null;
      const guideSlug = extractString(selectedSubmission.item.data, ['guideSlug', 'guideId', 'slug']);

      setSelectedGuideData(embeddedGuide);
      setSelectedGuideError(null);

      if (!activeDb || !guideSlug) {
        setSelectedGuideLoading(false);
        return;
      }

      setSelectedGuideLoading(true);

      try {
        const guideSnapshot = await getDoc(doc(activeDb, 'ingredient_guides', guideSlug));
        if (cancelled) return;

        if (guideSnapshot.exists()) {
          setSelectedGuideData(guideSnapshot.data() as Record<string, unknown>);
        }
      } catch (error) {
        console.error('Local swap guide detail load error', error);
        if (!cancelled) {
          setSelectedGuideError('Unable to load the linked guide details.');
        }
      } finally {
        if (!cancelled) {
          setSelectedGuideLoading(false);
        }
      }
    };

    void loadGuideData();

    return () => {
      cancelled = true;
    };
  }, [db, selectedSubmission]);

  const safeCount = useCallback(async (target: unknown) => {
    try {
      const snapshot = await getCountFromServer(target as never);
      return snapshot.data().count;
    } catch (error) {
      console.warn('Count failed', error);
      return null;
    }
  }, []);

  const loadStats = useCallback(async () => {
    if (!db) return;
    try {
      const usersQuery = collection(db, 'users');
      const recipesQuery = collection(db, 'recipes');
      const cookbooksQuery = collection(db, 'cookbooks');
      const swapsQuery = collection(db, LOCAL_SWAPS_COLLECTION);

      const [
        users,
        recipes,
        cookbooks,
        swaps,
        pendingRecipes,
        pendingRecipesLegacy,
        approvedRecipes,
        rejectedRecipes,
        pendingCookbooks,
        pendingCookbooksLegacy,
        approvedCookbooks,
        rejectedCookbooks,
        pendingSwaps,
      ] = await Promise.all([
        safeCount(usersQuery),
        safeCount(recipesQuery),
        safeCount(cookbooksQuery),
        safeCount(swapsQuery),
        safeCount(query(recipesQuery, where('approvalStatus', '==', 'pending'))),
        safeCount(query(recipesQuery, where('publishStatus', '==', 'pending'))),
        safeCount(query(recipesQuery, where('approvalStatus', '==', 'approved'))),
        safeCount(query(recipesQuery, where('approvalStatus', '==', 'rejected'))),
        safeCount(query(cookbooksQuery, where('approvalStatus', '==', 'pending'))),
        safeCount(query(cookbooksQuery, where('publishStatus', '==', 'pending'))),
        safeCount(query(cookbooksQuery, where('approvalStatus', '==', 'approved'))),
        safeCount(query(cookbooksQuery, where('approvalStatus', '==', 'rejected'))),
        safeCount(query(swapsQuery, where('approvalStatus', '==', 'pending'))),
      ]);

      setStats({
        users,
        recipes,
        pendingRecipes: pickCount(pendingRecipes, pendingRecipesLegacy),
        approvedRecipes,
        rejectedRecipes,
        cookbooks,
        pendingCookbooks: pickCount(pendingCookbooks, pendingCookbooksLegacy),
        approvedCookbooks,
        rejectedCookbooks,
        localSwaps: swaps,
        pendingLocalSwaps: pendingSwaps,
      });
    } finally {
      // counts are loaded into state above; no extra loading UI needed here
    }
  }, [safeCount]);

  const loadPending = useCallback(async () => {
    if (!db) return;
    try {
      const recipeQuery = query(
        collection(db, 'recipes'),
        where('approvalStatus', '==', 'pending'),
        limit(12)
      );
      const cookbookQuery = query(
        collection(db, 'cookbooks'),
        where('approvalStatus', '==', 'pending'),
        limit(12)
      );
      const [recipeSnapshot, cookbookSnapshot] = await Promise.all([
        getDocs(recipeQuery),
        getDocs(cookbookQuery),
      ]);

      let recipes = recipeSnapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<RecipeDoc, 'id'>),
      }));

      let cookbooks = cookbookSnapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<CookbookDoc, 'id'>),
      }));

      if (recipes.length === 0) {
        const legacySnapshot = await getDocs(
          query(
            collection(db, 'recipes'),
            where('publishStatus', '==', 'pending'),
            limit(12)
          )
        );
        recipes = legacySnapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<RecipeDoc, 'id'>),
        }));
      }

      if (cookbooks.length === 0) {
        const legacySnapshot = await getDocs(
          query(
            collection(db, 'cookbooks'),
            where('publishStatus', '==', 'pending'),
            limit(12)
          )
        );
        cookbooks = legacySnapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<CookbookDoc, 'id'>),
        }));
      }

      recipes.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      cookbooks.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

      setPendingRecipes(recipes);
      setPendingCookbooks(cookbooks);
    } catch (error) {
      console.error('Pending load error', error);
    }
  }, []);

  const loadLocalSwaps = useCallback(async () => {
    if (!db) return;
    try {
      const snapshot = await getDocs(
        query(
          collection(db, LOCAL_SWAPS_COLLECTION),
          where('approvalStatus', '==', 'pending'),
          limit(12)
        )
      );
      const swaps = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        data: docSnap.data() as Record<string, unknown>,
      }));
      swaps.sort(
        (a, b) =>
          toMillis(b.data.updatedAt ?? b.data.createdAt) -
          toMillis(a.data.updatedAt ?? a.data.createdAt)
      );
      setLocalSwaps(swaps);
      setLocalSwapError(null);
    } catch (error) {
      console.error('Local swaps load error', error);
      setLocalSwapError('Unable to load local swap requests.');
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!db) return;
    setHistoryLoading(true);
    try {
      const recipesQuery = collection(db, 'recipes');
      const cookbooksQuery = collection(db, 'cookbooks');
      const swapsQuery = collection(db, LOCAL_SWAPS_COLLECTION);

      const [
        approvedRecipesSnap,
        rejectedRecipesSnap,
        approvedCookbooksSnap,
        rejectedCookbooksSnap,
        approvedSwapsSnap,
        rejectedSwapsSnap,
      ] = await Promise.all([
        getDocs(query(recipesQuery, where('approvalStatus', '==', 'approved'), limit(20))),
        getDocs(query(recipesQuery, where('approvalStatus', '==', 'rejected'), limit(20))),
        getDocs(query(cookbooksQuery, where('approvalStatus', '==', 'approved'), limit(20))),
        getDocs(query(cookbooksQuery, where('approvalStatus', '==', 'rejected'), limit(20))),
        getDocs(query(swapsQuery, where('approvalStatus', '==', 'approved'), limit(20))),
        getDocs(query(swapsQuery, where('approvalStatus', '==', 'rejected'), limit(20))),
      ]);

      const history: HistoryItem[] = [];

      approvedRecipesSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as RecipeDoc;
        history.push({
          id: docSnap.id,
          type: 'recipe',
          title: data.title || 'Untitled recipe',
          author: data.ownerName || data.ownerId || 'Unknown',
          status: 'approved',
          date: data.updatedAt || data.createdAt,
        });
      });

      rejectedRecipesSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as RecipeDoc;
        history.push({
          id: docSnap.id,
          type: 'recipe',
          title: data.title || 'Untitled recipe',
          author: data.ownerName || data.ownerId || 'Unknown',
          status: 'rejected',
          date: data.updatedAt || data.createdAt,
        });
      });

      approvedCookbooksSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as CookbookDoc;
        history.push({
          id: docSnap.id,
          type: 'cookbook',
          title: data.title || 'Untitled cookbook',
          author: data.authorName || data.ownerId || 'Unknown',
          status: 'approved',
          date: data.updatedAt || data.createdAt,
        });
      });

      rejectedCookbooksSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as CookbookDoc;
        history.push({
          id: docSnap.id,
          type: 'cookbook',
          title: data.title || 'Untitled cookbook',
          author: data.authorName || data.ownerId || 'Unknown',
          status: 'rejected',
          date: data.updatedAt || data.createdAt,
        });
      });

      approvedSwapsSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const title = `${
          extractString(data, ['ingredient', 'original']) || 'Ingredient'
        } -> ${extractString(data, ['substitute', 'local', 'replacement']) || 'Substitute'}`;
        history.push({
          id: docSnap.id,
          type: 'swap',
          title,
          author: extractString(data, ['userName', 'createdBy']) || 'Unknown',
          status: 'approved',
          date: data.updatedAt || data.createdAt,
        });
      });

      rejectedSwapsSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const title = `${
          extractString(data, ['ingredient', 'original']) || 'Ingredient'
        } -> ${extractString(data, ['substitute', 'local', 'replacement']) || 'Substitute'}`;
        history.push({
          id: docSnap.id,
          type: 'swap',
          title,
          author: extractString(data, ['userName', 'createdBy']) || 'Unknown',
          status: 'rejected',
          date: data.updatedAt || data.createdAt,
        });
      });

      history.sort((a, b) => toMillis(b.date) - toMillis(a.date));
      setHistoryItems(history.slice(0, 40));
    } catch (error) {
      console.error('History load error', error);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadStats(), loadPending(), loadLocalSwaps(), loadHistory()]);
  }, [loadHistory, loadLocalSwaps, loadPending, loadStats]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeView === 'dashboard') {
      loadStats();
    }
    if (activeView === 'approvals') {
      loadPending();
      loadLocalSwaps();
    }
    if (activeView === 'history') {
      loadHistory();
    }
  }, [activeView, isAdmin, loadHistory, loadLocalSwaps, loadPending, loadStats]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) return;
    setLoginLoading(true);
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setPassword('');
    } catch (error) {
      console.error('Login error', error);
      setAuthError('Login failed. Please check your credentials.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  const clearSelectedIfMatches = (type: ReviewTarget['type'], id: string) => {
    setSelectedSubmission((current) => {
      if (!current) return current;
      return current.type === type && current.item.id === id ? null : current;
    });
  };

  const updateRecipeStatus = async (id: string, action: 'approve' | 'reject') => {
    if (!db || !authUser) return;
    setActionLoading(`recipe-${id}-${action}`);
    try {
      const isApprove = action === 'approve';
      await updateDoc(doc(db, 'recipes', id), {
        approvalStatus: isApprove ? 'approved' : 'rejected',
        publishStatus: isApprove ? 'approved' : 'rejected',
        isPublished: isApprove,
        approvedAt: isApprove ? serverTimestamp() : null,
        approvedBy: isApprove ? authUser.uid : null,
        updatedAt: serverTimestamp(),
      });
      await refreshAll();
      clearSelectedIfMatches('recipe', id);
    } catch (error) {
      console.error('Update recipe status error', error);
    } finally {
      setActionLoading(null);
    }
  };

  const updateCookbookStatus = async (id: string, action: 'approve' | 'reject') => {
    if (!db || !authUser) return;
    setActionLoading(`cookbook-${id}-${action}`);
    try {
      const isApprove = action === 'approve';
      await updateDoc(doc(db, 'cookbooks', id), {
        approvalStatus: isApprove ? 'approved' : 'rejected',
        publishStatus: isApprove ? 'approved' : 'rejected',
        isPublished: isApprove,
        approvedAt: isApprove ? serverTimestamp() : null,
        approvedBy: isApprove ? authUser.uid : null,
        updatedAt: serverTimestamp(),
      });
      await refreshAll();
      clearSelectedIfMatches('cookbook', id);
    } catch (error) {
      console.error('Update cookbook status error', error);
    } finally {
      setActionLoading(null);
    }
  };

  const updateLocalSwapStatus = async (swap: LocalSwapDoc, action: 'approve' | 'reject') => {
    if (!db || !authUser) return;
    setActionLoading(`swap-${swap.id}-${action}`);
    try {
      const isApprove = action === 'approve';
      const updatePayload = {
        approvalStatus: isApprove ? 'approved' : 'rejected',
        approvedAt: isApprove ? serverTimestamp() : null,
        approvedBy: isApprove ? authUser.uid : null,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, LOCAL_SWAPS_COLLECTION, swap.id), updatePayload);

      const guideSlug = swap.data.guideSlug;
      if (typeof guideSlug === 'string' && guideSlug.trim()) {
        await setDoc(
          doc(db, 'ingredient_guides', guideSlug),
          {
            approvalStatus: updatePayload.approvalStatus,
            approvedAt: updatePayload.approvedAt || null,
            approvedBy: updatePayload.approvedBy || null,
            updatedAt: updatePayload.updatedAt,
          },
          { merge: true }
        );
      }

      await refreshAll();
      clearSelectedIfMatches('swap', swap.id);
    } catch (error) {
      console.error('Update local swap status error', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSettingsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authUser) return;
    setSettingsSaving(true);
    setSettingsMessage('');
    try {
      if (settingsName && settingsName !== authUser.displayName) {
        await updateProfile(authUser, { displayName: settingsName });
      }
      if (settingsEmail && settingsEmail !== authUser.email) {
        await updateEmail(authUser, settingsEmail);
      }
      if (settingsPassword) {
        await updatePassword(authUser, settingsPassword);
      }
      setSettingsPassword('');
      setSettingsMessage('Profile updated successfully.');
    } catch (error) {
      console.error('Settings update error', error);
      setSettingsMessage('Unable to update settings. Please re-login if required.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const formatValue = (value: StatValue) =>
    typeof value === 'number' ? value.toLocaleString() : '--';

  const pendingRecipeCount =
    typeof stats.pendingRecipes === 'number' ? stats.pendingRecipes : pendingRecipes.length;
  const pendingCookbookCount =
    typeof stats.pendingCookbooks === 'number' ? stats.pendingCookbooks : pendingCookbooks.length;
  const pendingSwapCount =
    typeof stats.pendingLocalSwaps === 'number' ? stats.pendingLocalSwaps : localSwaps.length;

  const totalPending = [pendingRecipeCount, pendingCookbookCount, pendingSwapCount].reduce(
    (sum, value) => sum + (value || 0),
    0
  );

  const statCards = useMemo(
    () => [
      {
        label: 'Total Users',
        value: formatValue(stats.users),
        icon: icons.user,
        color: '#a78bfa',
        spark: [20, 45, 38, 70, 55, 90, 78, 95, 88, 110],
        sub: 'Active community',
      },
      {
        label: 'Total Recipes',
        value: formatValue(stats.recipes),
        icon: icons.recipe,
        color: '#f97316',
        spark: [10, 25, 15, 40, 30, 55, 45, 60, 50, 70],
        sub: 'Published recipes',
      },
      {
        label: 'Total Cookbooks',
        value: formatValue(stats.cookbooks),
        icon: icons.book,
        color: '#22d3ee',
        spark: [5, 8, 12, 10, 15, 18, 14, 20, 17, 22],
        sub: 'Community collections',
      },
      {
        label: 'Local Swaps',
        value: formatValue(stats.localSwaps),
        icon: icons.swap,
        color: '#f59e0b',
        spark: [30, 22, 35, 28, 40, 33, 45, 38, 50, 42],
        sub: 'Adaptations logged',
      },
    ],
    [stats]
  );

  const recipeSummary = {
    approved: stats.approvedRecipes ?? 0,
    rejected: stats.rejectedRecipes ?? 0,
    pending: pendingRecipeCount || 0,
  };

  const cookbookSummary = {
    approved: stats.approvedCookbooks ?? 0,
    rejected: stats.rejectedCookbooks ?? 0,
    pending: pendingCookbookCount || 0,
  };

  const navItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: icons.dashboard },
    { id: 'approvals' as const, label: 'Approvals', icon: icons.approvals, badge: totalPending },
    { id: 'history' as const, label: 'History', icon: icons.history },
    { id: 'settings' as const, label: 'Settings', icon: icons.settings },
  ];

  const typeColor = {
    recipe: '#f97316',
    cookbook: '#22d3ee',
    swap: '#f59e0b',
  } as const;

  const formatRecipeMeta = (recipe: RecipeDoc) => {
    const parts = [recipe.cuisine, recipe.category].filter(Boolean);
    const time = typeof recipe.cookTime === 'number' && recipe.cookTime > 0
      ? `${recipe.cookTime} min`
      : typeof recipe.prepTime === 'number' && recipe.prepTime > 0
        ? `${recipe.prepTime} min`
        : '';
    if (time) parts.push(time);
    return parts.join(' · ') || 'Recipe submission';
  };

  const formatCookbookMeta = (cookbook: CookbookDoc) => {
    if (typeof cookbook.recipesCount === 'number') {
      return `${cookbook.recipesCount} recipes`;
    }
    return 'Cookbook submission';
  };

  const formatSwapMeta = (swap: LocalSwapDoc) => {
    const reason = extractString(swap.data, ['reason', 'note']);
    return reason || 'Local swap request';
  };

  const isItemLoading = (type: ReviewTarget['type'], id: string) =>
    Boolean(actionLoading?.startsWith(`${type}-${id}`));

  const handleSelectedSubmissionAction = async (action: 'approve' | 'reject') => {
    if (!selectedSubmission) return;

    if (selectedSubmission.type === 'recipe') {
      await updateRecipeStatus(selectedSubmission.item.id, action);
      return;
    }

    if (selectedSubmission.type === 'cookbook') {
      await updateCookbookStatus(selectedSubmission.item.id, action);
      return;
    }

    await updateLocalSwapStatus(selectedSubmission.item, action);
  };

  const renderRecipeReview = (recipe: RecipeDoc) => {
    const imageUrl = pickImageUrl(recipe.imageUrl, recipe.image);
    const ingredients = (recipe.ingredients || []).map(formatIngredientLine).filter(Boolean);
    const instructions = formatTextList(recipe.instructions);

    return (
      <div className="flex flex-col gap-4">
        {imageUrl ? (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <img src={imageUrl} alt={recipe.title || 'Recipe'} className="h-72 w-full object-cover" />
          </div>
        ) : null}

        <DetailSection title="Overview">
          <p className="whitespace-pre-line text-sm leading-6 text-white/80">
            {recipe.description?.trim() || 'No description was provided with this recipe.'}
          </p>
        </DetailSection>

        <DetailSection title="Recipe Details" subtitle="Submission metadata and cooking information">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DetailField label="Cuisine" value={recipe.cuisine || null} />
            <DetailField label="Category" value={recipe.category || null} />
            <DetailField label="Difficulty" value={recipe.difficulty || null} />
            <DetailField
              label="Servings"
              value={typeof recipe.servings === 'number' ? String(recipe.servings) : null}
            />
            <DetailField
              label="Prep Time"
              value={typeof recipe.prepTime === 'number' ? `${recipe.prepTime} min` : null}
            />
            <DetailField
              label="Cook Time"
              value={typeof recipe.cookTime === 'number' ? `${recipe.cookTime} min` : null}
            />
          </div>
        </DetailSection>

        <DetailSection title="Ingredients" subtitle={`${ingredients.length} items submitted`}>
          {ingredients.length > 0 ? (
            <ul className="space-y-2">
              {ingredients.map((ingredient, index) => (
                <li
                  key={`${ingredient}-${index}`}
                  className="rounded-xl border border-white/10 bg-[#121221] px-4 py-3 text-sm text-white/85"
                >
                  {ingredient}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/45">No ingredients were provided.</p>
          )}
        </DetailSection>

        <DetailSection title="Instructions" subtitle={`${instructions.length} steps submitted`}>
          {instructions.length > 0 ? (
            <ol className="space-y-3">
              {instructions.map((instruction, index) => (
                <li
                  key={`${instruction}-${index}`}
                  className="flex gap-3 rounded-xl border border-white/10 bg-[#121221] px-4 py-3"
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ background: '#f97316' }}
                  >
                    {index + 1}
                  </span>
                  <p className="text-sm leading-6 text-white/85">{instruction}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-white/45">No cooking steps were provided.</p>
          )}
        </DetailSection>
      </div>
    );
  };

  const renderCookbookReview = (cookbook: CookbookDoc) => {
    const categories = (cookbook.categories || []).filter(Boolean);
    const fallbackRecipeRefs = (cookbook.recipes || []).map(formatRecipeReference).filter(Boolean);
    const imagePanels = [
      { label: 'Cover', url: pickImageUrl(cookbook.coverImageUrl) },
      { label: 'Introduction', url: pickImageUrl(cookbook.introImageUrl) },
      { label: 'Thank You', url: pickImageUrl(cookbook.thankYouImageUrl) },
    ].filter((panel) => panel.url);

    return (
      <div className="flex flex-col gap-4">
        {imagePanels.length > 0 ? (
          <DetailSection title="Images" subtitle="Artwork included with the cookbook submission">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {imagePanels.map((panel) => (
                <div
                  key={panel.label}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-[#121221]"
                >
                  <img src={panel.url} alt={panel.label} className="h-52 w-full object-cover" />
                  <div className="border-t border-white/10 px-4 py-3 text-sm font-medium text-white/80">
                    {panel.label}
                  </div>
                </div>
              ))}
            </div>
          </DetailSection>
        ) : null}

        <DetailSection title="Cookbook Details" subtitle="Core submission metadata">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DetailField label="Author" value={cookbook.authorName || null} />
            <DetailField
              label="Recipes Count"
              value={typeof cookbook.recipesCount === 'number' ? String(cookbook.recipesCount) : null}
            />
            <DetailField label="Visibility" value={cookbook.shareVisibility || null} />
            <DetailField label="Occupation" value={cookbook.occupation || null} />
            <DetailField
              label="Categories"
              value={categories.length > 0 ? categories.join(', ') : null}
            />
          </div>
        </DetailSection>

        <DetailSection title="Introduction">
          <p className="whitespace-pre-line text-sm leading-6 text-white/80">
            {cookbook.introduction?.trim() || 'No introduction was provided.'}
          </p>
        </DetailSection>

        <DetailSection title="About the Author">
          <p className="whitespace-pre-line text-sm leading-6 text-white/80">
            {cookbook.aboutAuthor?.trim() || 'No author background was provided.'}
          </p>
        </DetailSection>

        <DetailSection title="Thank You Note">
          <p className="whitespace-pre-line text-sm leading-6 text-white/80">
            {cookbook.thankYouMessage?.trim() || 'No thank you note was provided.'}
          </p>
        </DetailSection>

        <DetailSection
          title="Included Recipes"
          subtitle={
            selectedCookbookRecipesLoading
              ? 'Loading linked recipe documents...'
              : 'Recipes referenced by this cookbook submission'
          }
        >
          {selectedCookbookRecipesError ? (
            <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {selectedCookbookRecipesError}
            </div>
          ) : null}

          {selectedCookbookRecipes.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {selectedCookbookRecipes.map((recipe) => (
                <div key={recipe.id} className="rounded-xl border border-white/10 bg-[#121221] px-4 py-3">
                  <p className="text-sm font-semibold text-white">{recipe.title || 'Untitled recipe'}</p>
                  <p className="mt-1 text-xs text-white/45">{formatRecipeMeta(recipe)}</p>
                </div>
              ))}
            </div>
          ) : fallbackRecipeRefs.length > 0 ? (
            <ul className="space-y-2">
              {fallbackRecipeRefs.map((item, index) => (
                <li
                  key={`${item}-${index}`}
                  className="rounded-xl border border-white/10 bg-[#121221] px-4 py-3 text-sm text-white/85"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/45">No recipe references were stored with this cookbook.</p>
          )}
        </DetailSection>
      </div>
    );
  };

  const renderSwapReview = (swap: LocalSwapDoc) => {
    const guideData = selectedGuideData;
    const ingredient = extractString(swap.data, ['ingredient', 'original']) || 'Not provided';
    const substitute =
      extractString(swap.data, ['substitute', 'local', 'replacement']) || 'Not provided';
    const reason = extractString(swap.data, ['reason', 'note']);
    const guideSlug = extractString(swap.data, ['guideSlug', 'guideId', 'slug']);
    const guideName = guideData ? extractString(guideData, ['name', 'title']) : '';
    const guideDescription = guideData ? extractString(guideData, ['description']) : '';
    const guideYield = guideData ? extractString(guideData, ['yield']) : '';
    const formattedGuideIngredients = guideData
      ? (Array.isArray(guideData.ingredients) ? guideData.ingredients : [])
          .map(formatIngredientLine)
          .filter(Boolean)
      : [];
    const guideSteps = guideData ? formatTextList(guideData.steps) : [];
    const guideTips = guideData ? formatTextList(guideData.tips) : [];
    const guideEquipment = guideData ? formatTextList(guideData.equipment) : [];
    const guideImageUrl = pickImageUrl(
      guideData ? guideData.imageUrl : '',
      swap.data.imageUrl,
      swap.data.photoUrl
    );

    return (
      <div className="flex flex-col gap-4">
        <DetailSection title="Swap Details" subtitle="Primary substitution request">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DetailField label="Original Ingredient" value={ingredient} />
            <DetailField label="Suggested Substitute" value={substitute} />
            <DetailField label="Guide Slug" value={guideSlug || null} />
            <DetailField label="Guide Name" value={guideName || null} />
            <DetailField label="Yield" value={guideYield || null} />
          </div>
        </DetailSection>

        <DetailSection title="Why it Works">
          <p className="whitespace-pre-line text-sm leading-6 text-white/80">
            {reason || 'No explanation was provided with this substitution.'}
          </p>
        </DetailSection>

        {guideImageUrl ? (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <img src={guideImageUrl} alt={guideName || substitute} className="h-72 w-full object-cover" />
          </div>
        ) : null}

        <DetailSection
          title="Guide Overview"
          subtitle={selectedGuideLoading ? 'Loading guide details...' : 'Linked preparation guide'}
        >
          {selectedGuideError ? (
            <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {selectedGuideError}
            </div>
          ) : null}
          <p className="whitespace-pre-line text-sm leading-6 text-white/80">
            {guideDescription || 'No guide description was provided.'}
          </p>
        </DetailSection>

        <DetailSection title="Guide Ingredients" subtitle={`${formattedGuideIngredients.length} items`}>
          {formattedGuideIngredients.length > 0 ? (
            <ul className="space-y-2">
              {formattedGuideIngredients.map((item, index) => (
                <li
                  key={`${item}-${index}`}
                  className="rounded-xl border border-white/10 bg-[#121221] px-4 py-3 text-sm text-white/85"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/45">No guide ingredients were provided.</p>
          )}
        </DetailSection>

        <DetailSection title="Guide Steps" subtitle={`${guideSteps.length} steps`}>
          {guideSteps.length > 0 ? (
            <ol className="space-y-3">
              {guideSteps.map((step, index) => (
                <li
                  key={`${step}-${index}`}
                  className="flex gap-3 rounded-xl border border-white/10 bg-[#121221] px-4 py-3"
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ background: '#f59e0b' }}
                  >
                    {index + 1}
                  </span>
                  <p className="text-sm leading-6 text-white/85">{step}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-white/45">No guide steps were provided.</p>
          )}
        </DetailSection>

        {guideTips.length > 0 || guideEquipment.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <DetailSection title="Tips" subtitle={`${guideTips.length} notes`}>
              {guideTips.length > 0 ? (
                <ul className="space-y-2">
                  {guideTips.map((tip, index) => (
                    <li
                      key={`${tip}-${index}`}
                      className="rounded-xl border border-white/10 bg-[#121221] px-4 py-3 text-sm text-white/85"
                    >
                      {tip}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/45">No preparation tips were provided.</p>
              )}
            </DetailSection>

            <DetailSection title="Equipment" subtitle={`${guideEquipment.length} items`}>
              {guideEquipment.length > 0 ? (
                <ul className="space-y-2">
                  {guideEquipment.map((item, index) => (
                    <li
                      key={`${item}-${index}`}
                      className="rounded-xl border border-white/10 bg-[#121221] px-4 py-3 text-sm text-white/85"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/45">No equipment list was provided.</p>
              )}
            </DetailSection>
          </div>
        ) : null}
      </div>
    );
  };

  if (!hasFirebaseConfig) {
    return (
      <div className="min-h-screen bg-[#0f0f1a] text-white flex items-center justify-center p-6">
        <div className="max-w-xl rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl">
          <h1 className="text-xl font-semibold text-white">Firebase config missing</h1>
          <p className="mt-2 text-sm text-white/60">
            Add your Firebase web configuration to `FlavorMindAdmin/.env` with VITE_ prefixes.
          </p>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0f0f1a] text-white flex items-center justify-center">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-white/70">
          Loading admin console...
        </div>
      </div>
    );
  }

  if (!authUser || !isAdmin) {
    return (
      <div className="min-h-screen bg-[#0f0f1a] text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl">
          <div className="flex items-center gap-3">
            <BrandLogo size={48} />
            <div>
              <h1 className="text-xl font-semibold text-white">FlavorMind Admin</h1>
              <p className="text-sm text-white/50">Sign in to manage approvals.</p>
            </div>
          </div>
          {authError ? (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {authError}
            </div>
          ) : null}
          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <label className="block text-sm font-medium text-white/70">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-white/70">
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={loginLoading}
              className="w-full rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-60"
            >
              {loginLoading ? 'Signing in...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0f0f1a] text-white">
      <aside
        className={`flex flex-col border-r border-white/10 bg-white/5 transition-all ${
          sidebarCollapsed ? 'w-[72px]' : 'w-[240px]'
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-5">
          <BrandLogo size={36} roundedClassName="rounded-xl" />
          {!sidebarCollapsed && (
            <div>
              <p className="text-sm font-semibold text-white" style={{ fontFamily: 'DM Serif Display, serif' }}>
                FlavorMind
              </p>
              <p className="text-[11px] text-white/40">Admin Console</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 px-2">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                  isActive
                    ? 'border border-amber-500/30 bg-amber-500/10 text-amber-400'
                    : 'text-white/50 hover:bg-white/5'
                }`}
              >
                <Icon d={item.icon} size={17} style={{ color: 'inherit' }} />
                {!sidebarCollapsed && (
                  <span className="flex-1 text-left">{item.label}</span>
                )}
                {!sidebarCollapsed && item.badge && item.badge > 0 && (
                  <span className="rounded-full bg-amber-500 px-2 py-[2px] text-[11px] font-semibold text-white">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="px-3 pb-4">
          <button
            onClick={() => setSidebarCollapsed((value) => !value)}
            className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-white/40 flex items-center justify-center gap-2"
          >
            <Icon d={sidebarCollapsed ? icons.chevR : icons.chevL} size={15} style={{ color: 'currentColor' }} />
            {!sidebarCollapsed && 'Collapse'}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="px-4 pb-4 text-[11px] text-white/40 border-t border-white/5 pt-3">
            Signed in as
            <p className="mt-1 text-white/60 truncate">{authUser.email || 'Admin'}</p>
          </div>
        )}
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="h-[70px] flex items-center justify-between border-b border-white/10 bg-white/5 px-8">
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-white/30">Admin Panel</p>
            <p className="text-xl font-semibold text-white" style={{ fontFamily: 'DM Serif Display, serif' }}>
              {navItems.find((item) => item.id === activeView)?.label}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-400"
          >
            <Icon d={icons.logout} size={15} style={{ color: '#ef4444' }} /> Logout
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-7 space-y-8">
          {activeView === 'dashboard' && (
            <div className="flex flex-col gap-8">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {statCards.map((card) => (
                  <StatCard key={card.label} {...card} />
                ))}
              </div>

              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
                  Pending Review
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { label: 'Recipes', count: pendingRecipeCount, color: '#f97316' },
                    { label: 'Cookbooks', count: pendingCookbookCount, color: '#22d3ee' },
                    { label: 'Local Swaps', count: pendingSwapCount, color: '#f59e0b' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl border px-4 py-4 flex items-center gap-4"
                      style={{ background: `${item.color}10`, borderColor: `${item.color}28` }}
                    >
                      <span
                        className="text-3xl font-bold"
                        style={{ color: item.color, fontFamily: 'DM Mono, monospace' }}
                      >
                        {item.count ?? 0}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-white">{item.label}</p>
                        <p className="text-xs text-white/40">Awaiting approval</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                {[
                  { title: 'Recipe Approvals', data: recipeSummary },
                  { title: 'Cookbook Approvals', data: cookbookSummary },
                ].map((section) => {
                  const total =
                    section.data.approved + section.data.rejected + section.data.pending || 1;
                  return (
                    <div key={section.title} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                      <p className="text-lg font-semibold text-white" style={{ fontFamily: 'DM Serif Display, serif' }}>
                        {section.title}
                      </p>
                      <p className="text-sm text-white/40 mt-1">Approved vs Rejected vs Pending</p>
                      <div className="mt-6 flex items-center gap-6">
                        <DonutChart
                          approved={section.data.approved}
                          rejected={section.data.rejected}
                          pending={section.data.pending}
                        />
                        <div className="flex flex-col gap-3 flex-1">
                          {[
                            { label: 'Approved', value: section.data.approved, color: '#22c55e' },
                            { label: 'Rejected', value: section.data.rejected, color: '#ef4444' },
                            { label: 'Pending', value: section.data.pending, color: '#f59e0b' },
                          ].map((item) => (
                            <div key={item.label} className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                              <span className="text-sm text-white/60 flex-1">{item.label}</span>
                              <span className="text-sm font-semibold text-white" style={{ fontFamily: 'DM Mono, monospace' }}>
                                {item.value} <span className="text-[11px] text-white/40">({Math.round((item.value / total) * 100)}%)</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeView === 'approvals' && (
            <div className="flex flex-col gap-10">
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Icon d={icons.recipe} size={16} style={{ color: '#f97316' }} />
                  <p className="text-lg font-semibold text-white" style={{ fontFamily: 'DM Serif Display, serif' }}>
                    Pending Recipes
                  </p>
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
                    {pendingRecipes.length}
                  </span>
                </div>
                {pendingRecipes.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/40">
                    ? All caught up — no pending recipes
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {pendingRecipes.map((recipe) => (
                      <ApprovalCard
                        key={recipe.id}
                        title={recipe.title || 'Untitled recipe'}
                        meta={formatRecipeMeta(recipe)}
                        author={recipe.ownerName || recipe.ownerId || 'Unknown'}
                        email={recipe.ownerEmail || '—'}
                        submitted={formatDate(recipe.createdAt)}
                        onView={() => setSelectedSubmission({ type: 'recipe', item: recipe })}
                        onApprove={() => updateRecipeStatus(recipe.id, 'approve')}
                        onReject={() => updateRecipeStatus(recipe.id, 'reject')}
                        loading={isItemLoading('recipe', recipe.id)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Icon d={icons.book} size={16} style={{ color: '#22d3ee' }} />
                  <p className="text-lg font-semibold text-white" style={{ fontFamily: 'DM Serif Display, serif' }}>
                    Pending Cookbooks
                  </p>
                  <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300">
                    {pendingCookbooks.length}
                  </span>
                </div>
                {pendingCookbooks.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/40">
                    ? All caught up — no pending cookbooks
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {pendingCookbooks.map((cookbook) => (
                      <ApprovalCard
                        key={cookbook.id}
                        title={cookbook.title || 'Untitled cookbook'}
                        meta={formatCookbookMeta(cookbook)}
                        author={cookbook.authorName || cookbook.ownerId || 'Unknown'}
                        email={cookbook.ownerEmail || '—'}
                        submitted={formatDate(cookbook.createdAt)}
                        onView={() => setSelectedSubmission({ type: 'cookbook', item: cookbook })}
                        onApprove={() => updateCookbookStatus(cookbook.id, 'approve')}
                        onReject={() => updateCookbookStatus(cookbook.id, 'reject')}
                        loading={isItemLoading('cookbook', cookbook.id)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Icon d={icons.swap} size={16} style={{ color: '#f59e0b' }} />
                  <p className="text-lg font-semibold text-white" style={{ fontFamily: 'DM Serif Display, serif' }}>
                    Pending Local Swaps
                  </p>
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
                    {localSwaps.length}
                  </span>
                </div>
                {localSwapError ? (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-300">
                    {localSwapError}
                  </div>
                ) : null}
                {localSwaps.length === 0 && !localSwapError ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/40">
                    ? All caught up — no pending swaps
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {localSwaps.map((swap) => {
                      const ingredient = extractString(swap.data, ['ingredient', 'original']) || 'Ingredient';
                      const substitute =
                        extractString(swap.data, ['substitute', 'local', 'replacement']) || 'Substitute';
                      const author = extractString(swap.data, ['userName', 'createdBy']) || 'Unknown';
                      const email = extractString(swap.data, ['userEmail', 'email']) || '—';
                      const submitted = formatDate(
                        swap.data.updatedAt || swap.data.createdAt || new Date().toISOString()
                      );

                      return (
                        <ApprovalCard
                          key={swap.id}
                          title={`${ingredient} -> ${substitute}`}
                          meta={formatSwapMeta(swap)}
                          author={author}
                          email={email}
                          submitted={submitted}
                          onView={() => setSelectedSubmission({ type: 'swap', item: swap })}
                          onApprove={() => updateLocalSwapStatus(swap, 'approve')}
                          onReject={() => updateLocalSwapStatus(swap, 'reject')}
                          loading={isItemLoading('swap', swap.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeView === 'history' && (
            <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {['Type', 'Title', 'Author', 'Action', 'Date'].map((heading) => (
                      <th
                        key={heading}
                        className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyLoading && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-white/40">
                        Loading history...
                      </td>
                    </tr>
                  )}
                  {!historyLoading && historyItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-white/40">
                        No history yet.
                      </td>
                    </tr>
                  )}
                  {!historyLoading &&
                    historyItems.map((row) => (
                      <tr key={row.id} className="border-b border-white/5">
                        <td className="px-5 py-3">
                          <span
                            className="rounded-lg px-2 py-1 text-xs font-semibold"
                            style={{
                              background: `${typeColor[row.type]}20`,
                              color: typeColor[row.type],
                            }}
                          >
                            {row.type}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-white font-medium">{row.title}</td>
                        <td className="px-5 py-3 text-white/60">{row.author}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{
                                background: row.status === 'approved' ? '#22c55e' : '#ef4444',
                              }}
                            />
                            <span
                              className="text-sm font-semibold capitalize"
                              style={{
                                color: row.status === 'approved' ? '#22c55e' : '#ef4444',
                              }}
                            >
                              {row.status}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-white/40" style={{ fontFamily: 'DM Mono, monospace' }}>
                          {formatDate(row.date)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {activeView === 'settings' && (
            <div className="max-w-lg">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
                <p className="text-xl font-semibold text-white" style={{ fontFamily: 'DM Serif Display, serif' }}>
                  Account Settings
                </p>
                <p className="mt-1 text-sm text-white/40">Update your admin credentials below</p>

                {settingsMessage && (
                  <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    {settingsMessage}
                  </div>
                )}

                <form className="mt-6 space-y-5" onSubmit={handleSettingsSubmit}>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
                    Display name
                    <div className="relative mt-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
                        <Icon d={icons.user} size={15} />
                      </span>
                      <input
                        type="text"
                        value={settingsName}
                        onChange={(event) => setSettingsName(event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-10 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </label>

                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
                    Email address
                    <div className="relative mt-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
                        <Icon d={icons.mail} size={15} />
                      </span>
                      <input
                        type="email"
                        value={settingsEmail}
                        onChange={(event) => setSettingsEmail(event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-10 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </label>

                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
                    New password
                    <div className="relative mt-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
                        <Icon d={icons.lock} size={15} />
                      </span>
                      <input
                        type="password"
                        value={settingsPassword}
                        onChange={(event) => setSettingsPassword(event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-10 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </label>

                  <button
                    type="submit"
                    disabled={settingsSaving}
                    className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-pink-500 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {settingsSaving ? 'Saving...' : 'Save changes'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {selectedSubmission && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-[#05030d]/80 p-4 backdrop-blur-sm"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedSubmission(null);
                }
              }}
            >
              <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#10101d] shadow-2xl">
                <div className="border-b border-white/10 px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
                          style={{
                            background: `${typeColor[selectedSubmission.type]}18`,
                            color: typeColor[selectedSubmission.type],
                          }}
                        >
                          {selectedSubmission.type}
                        </span>
                        <span className="text-xs text-white/35">Pending review</span>
                      </div>
                      <h2
                        className="mt-3 text-2xl font-semibold text-white"
                        style={{ fontFamily: 'DM Serif Display, serif' }}
                      >
                        {selectedSubmission.type === 'recipe' && (selectedSubmission.item.title || 'Untitled recipe')}
                        {selectedSubmission.type === 'cookbook' && (selectedSubmission.item.title || 'Untitled cookbook')}
                        {selectedSubmission.type === 'swap' && `${extractString(selectedSubmission.item.data, ['ingredient', 'original']) || 'Ingredient'} -> ${extractString(selectedSubmission.item.data, ['substitute', 'local', 'replacement']) || 'Substitute'}`}
                      </h2>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {selectedSubmission.type === 'recipe' && (
                          <>
                            <DetailField
                              label="Submitted By"
                              value={selectedSubmission.item.ownerName || selectedSubmission.item.ownerId || 'Unknown'}
                            />
                            <DetailField label="Email" value={selectedSubmission.item.ownerEmail || null} />
                            <DetailField label="Submitted" value={formatDate(selectedSubmission.item.createdAt)} />
                            <DetailField label="Summary" value={formatRecipeMeta(selectedSubmission.item)} />
                          </>
                        )}
                        {selectedSubmission.type === 'cookbook' && (
                          <>
                            <DetailField
                              label="Submitted By"
                              value={selectedSubmission.item.authorName || selectedSubmission.item.ownerId || 'Unknown'}
                            />
                            <DetailField label="Email" value={selectedSubmission.item.ownerEmail || null} />
                            <DetailField label="Submitted" value={formatDate(selectedSubmission.item.createdAt)} />
                            <DetailField label="Summary" value={formatCookbookMeta(selectedSubmission.item)} />
                          </>
                        )}
                        {selectedSubmission.type === 'swap' && (
                          <>
                            <DetailField
                              label="Submitted By"
                              value={extractString(selectedSubmission.item.data, ['userName', 'createdBy']) || 'Unknown'}
                            />
                            <DetailField
                              label="Email"
                              value={extractString(selectedSubmission.item.data, ['userEmail', 'email']) || null}
                            />
                            <DetailField
                              label="Submitted"
                              value={formatDate(selectedSubmission.item.data.updatedAt || selectedSubmission.item.data.createdAt)}
                            />
                            <DetailField label="Summary" value={formatSwapMeta(selectedSubmission.item)} />
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedSubmission(null)}
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition hover:text-white"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6">
                  {selectedSubmission.type === 'recipe' && renderRecipeReview(selectedSubmission.item)}
                  {selectedSubmission.type === 'cookbook' && renderCookbookReview(selectedSubmission.item)}
                  {selectedSubmission.type === 'swap' && renderSwapReview(selectedSubmission.item)}
                </div>

                <div className="border-t border-white/10 px-6 py-4">
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setSelectedSubmission(null)}
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSelectedSubmissionAction('reject');
                      }}
                      disabled={isItemLoading(selectedSubmission.type, selectedSubmission.item.id)}
                      className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 disabled:opacity-60"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSelectedSubmissionAction('approve');
                      }}
                      disabled={isItemLoading(selectedSubmission.type, selectedSubmission.item.id)}
                      className="rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;

