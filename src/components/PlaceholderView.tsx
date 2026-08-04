import type { LucideIcon } from "lucide-react";

export default function PlaceholderView({
  icon: Icon,
  title,
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Icon className="h-10 w-10 text-white/20" />
      <div className="text-[14px] font-medium text-white/60">{title}</div>
      <div className="text-[12.5px] text-white/35">此视图将在接入后端后启用</div>
    </div>
  );
}
