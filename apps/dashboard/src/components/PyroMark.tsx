import type { SVGProps } from "react";

export function PyroMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <circle cx="16" cy="16" r="16" fill="#fff" />
      <path
        fill="#0c0c0c"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 1.75 26.25 12.6 22.1 30 16 25.25 9.9 30 5.75 12.6 16 1.75Zm0 7.1-5.05 5.65 2.15 8.85L16 21.1l2.9 2.25 2.15-8.85L16 8.85Z"
      />
      <path d="M16 9v12" stroke="#0c0c0c" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}
