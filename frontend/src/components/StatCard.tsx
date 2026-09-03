import { ReactNode } from 'react';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: number;
  color?: 'red' | 'blue' | 'yellow' | 'green' | 'purple';
  onClick?: () => void;
}

const TONES = {
  red: { bg: 'bg-red-50', ring: 'ring-red-100', text: 'text-red-600' },
  blue: { bg: 'bg-blue-50', ring: 'ring-blue-100', text: 'text-blue-600' },
  yellow: { bg: 'bg-amber-50', ring: 'ring-amber-100', text: 'text-amber-600' },
  green: { bg: 'bg-emerald-50', ring: 'ring-emerald-100', text: 'text-emerald-600' },
  purple: { bg: 'bg-purple-50', ring: 'ring-purple-100', text: 'text-purple-600' },
};

export default function StatCard({ icon, label, value, color = 'blue', onClick }: StatCardProps) {
  const tone = TONES[color] ?? TONES.blue;
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      className={`w-full rounded-xl ${tone.bg} p-5 text-left ring-1 ring-inset ${tone.ring} ${
        onClick ? 'cursor-pointer transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-600">{label}</p>
          <p className={`mt-0.5 text-3xl font-semibold ${tone.text}`}>{value}</p>
        </div>
        <div className={`shrink-0 ${tone.text} opacity-40`}>{icon}</div>
      </div>
    </Tag>
  );
}
