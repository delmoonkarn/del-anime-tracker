
import { Sparkles } from 'lucide-react';

interface Props {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="max-w-md mx-auto text-center py-24 px-4">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-indigo-500/10 text-indigo-400 mb-4">
        <Sparkles className="w-6 h-6" />
      </div>
      <h2 className="text-xl font-semibold mb-1">{title}</h2>
      <p className="text-sm text-zinc-400 mb-6">{description}</p>
      {action}
    </div>
  );
}
