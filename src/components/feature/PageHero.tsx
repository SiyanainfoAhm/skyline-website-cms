type PageHeroProps = {
  title: string;
  breadcrumb?: string;
  lead?: string;
};

export default function PageHero({ title, lead }: PageHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-background-200 bg-background-100">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary-100/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-10 h-56 w-56 rounded-full bg-primary-100/60 blur-3xl" />
      <div className="site-container relative py-12 md:py-16">
        <h1 className="max-w-4xl animate-fade-up font-heading text-3xl font-bold leading-tight text-foreground-950 md:text-[2.75rem]">
          {title}
        </h1>
        {lead ? (
          <p
            className="mt-4 max-w-3xl animate-fade-up text-base leading-relaxed text-foreground-600"
            style={{ animationDelay: "0.12s" }}
          >
            {lead}
          </p>
        ) : null}
      </div>
    </section>
  );
}