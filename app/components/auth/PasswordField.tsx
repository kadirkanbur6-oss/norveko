"use client";

// app/components/auth/PasswordField.tsx
// Şifre alanı + göster/gizle düğmesi. id/name/autoComplete verildiği için
// tarayıcı ve şifre yöneticileri alanı doğru tanır.

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export const AUTH_INPUT_CLASS =
  "mt-2 w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20";

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  minLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-300">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          spellCheck={false}
          className={`${AUTH_INPUT_CLASS} pr-12`}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-3 top-1/2 mt-1 -translate-y-1/2 rounded-full p-1.5 text-gray-400 transition hover:text-white"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
