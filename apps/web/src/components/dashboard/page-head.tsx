export function PageHead({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start md:items-center justify-between gap-4 md:gap-6 mb-6 md:mb-8 flex-wrap">
      <div>
        <h1 className="font-bold text-[22px] md:text-[26px] tracking-tight leading-tight m-0">
          {title}
        </h1>
        {sub && (
          <div className="text-muted-foreground text-[13px] mt-1">{sub}</div>
        )}
      </div>
      {actions && (
        <div className="flex gap-2 items-center flex-wrap">{actions}</div>
      )}
    </div>
  );
}
