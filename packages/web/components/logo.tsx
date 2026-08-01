export function NoxSwapMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="NoxSwap logo"
    >
      <circle cx="13" cy="16" r="9" fill="#7c3aed" />
      <circle cx="19" cy="16" r="9" fill="#0f172a" fillOpacity="0.92" />
      <path
        d="M19 7a9 9 0 0 1 0 18 9 9 0 0 1 0-18z"
        fill="#0f172a"
        fillOpacity="0.92"
      />
      <circle cx="19" cy="16" r="3.2" fill="#a78bfa" />
    </svg>
  );
}
