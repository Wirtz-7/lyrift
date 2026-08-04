import { Music2 } from "lucide-react";
import { useState } from "react";

export default function CoverArt({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken)
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-violet-600/50 to-indigo-950 text-white/40 ${className ?? ""}`}
      >
        <Music2 className="h-1/3 w-1/3" />
      </div>
    );
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      onError={() => setBroken(true)}
      className={className}
    />
  );
}
