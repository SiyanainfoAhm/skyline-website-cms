import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { NavItem } from "@/data/site";
import { usePublicSite } from "@/hooks/usePublicSite";

function Logo({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="h-11 w-auto object-contain md:h-12" />;
}

function DesktopDropdown({ item }: { item: NavItem }) {
  return (
    <div className="absolute left-0 top-full z-50 hidden pt-3 group-hover:block group-focus-within:block">
      <div className="min-w-[240px] rounded-card border border-background-200 bg-background-50 p-3 shadow-xl">
        <ul className="space-y-1">
          {(item.children ?? []).map((child) => (
            <li key={child.to}>
              <Link
                to={child.to}
                className="block rounded-md px-3 py-2 text-sm text-foreground-700 transition-colors hover:bg-background-100 hover:text-primary-600"
              >
                {child.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [query, setQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const { data } = usePublicSite();
  const { navigation, settings } = data;

  const courseMenu = navigation.find((item) => item.columns);
  const courseColumns = courseMenu?.columns ?? [];

  useEffect(() => {
    setMobileOpen(false);
    setOpenAccordion(null);
    setSearchOpen(false);
    setCoursesOpen(false);
  }, [location.pathname]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    setSearchOpen(false);
    setQuery("");
    navigate(value ? `/our-courses?q=${encodeURIComponent(value)}` : "/our-courses");
  };

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="hidden border-b border-background-200 bg-background-100 md:block">
        <div className="site-container flex items-center justify-between py-2.5">
          <div className="flex items-center gap-3">
            {settings.social.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className="flex h-8 w-8 items-center justify-center rounded-full text-foreground-600 transition-colors hover:bg-background-200 hover:text-primary-600"
              >
                <i className={`${social.icon} text-base`} aria-hidden="true" />
              </a>
            ))}
          </div>
          <div className="flex items-center gap-6">
            <a href={settings.phoneHref} className="flex items-center gap-2 text-sm text-foreground-700 hover:text-primary-600">
              <i className="ri-phone-line text-base text-primary-600" aria-hidden="true" />
              <span className="font-label text-xs uppercase tracking-wide text-foreground-500">Call Now !</span>
              <strong className="font-semibold">{settings.phone}</strong>
            </a>
            <a href={settings.emailHref} className="flex items-center gap-2 text-sm text-foreground-700 hover:text-primary-600">
              <i className="ri-mail-line text-base text-primary-600" aria-hidden="true" />
              <span className="font-label text-xs uppercase tracking-wide text-foreground-500">Email Now</span>
              <strong className="font-semibold">{settings.email}</strong>
            </a>
          </div>
        </div>
      </div>

      <div
        className="relative border-b border-background-200 bg-background-50/95 backdrop-blur"
        onMouseLeave={() => setCoursesOpen(false)}
      >
        <div className="site-container flex items-center justify-between py-3.5">
          <Link to="/" aria-label={settings.logoAlt} className="flex items-center">
            <Logo src={settings.logo} alt={settings.logoAlt} />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
            {navigation.map((item) => (
              <div
                key={item.label}
                className="group relative"
                onMouseEnter={() => setCoursesOpen(Boolean(item.columns))}
              >
                {item.to && !item.children && !item.columns ? (
                  <Link
                    to={item.to}
                    className="flex items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:text-primary-600"
                  >
                    {item.label}
                  </Link>
                ) : item.to ? (
                  <Link
                    to={item.to}
                    aria-haspopup="true"
                    aria-expanded={item.columns ? coursesOpen : undefined}
                    onFocus={() => setCoursesOpen(Boolean(item.columns))}
                    className="flex items-center gap-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:text-primary-600"
                  >
                    {item.label}
                    <i className="ri-arrow-down-s-line text-base" aria-hidden="true" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    aria-haspopup="true"
                    className="flex items-center gap-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:text-primary-600"
                  >
                    {item.label}
                    <i className="ri-arrow-down-s-line text-base" aria-hidden="true" />
                  </button>
                )}
                {item.children ? <DesktopDropdown item={item} /> : null}
              </div>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen((open) => !open)}
              aria-label="Search courses"
              aria-expanded={searchOpen}
              className="hidden h-10 w-10 items-center justify-center rounded-full text-foreground-700 transition-colors hover:bg-background-100 hover:text-primary-600 md:flex"
            >
              <i className="ri-search-line text-lg" aria-hidden="true" />
            </button>
            <Link
              to="/agency/login"
              className="hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm font-semibold text-primary-700 transition-colors hover:border-primary-300 hover:bg-primary-100 md:inline-flex"
            >
              <i className="ri-user-3-line text-base" aria-hidden="true" />
              Agency Portal
            </Link>
            <Link
              to="/admin/login"
              className="hidden whitespace-nowrap text-sm font-medium text-foreground-700 transition-colors hover:text-primary-600 md:block"
            >
              Sign In
            </Link>
            <Link
              to="/enroll-now"
              className="hidden whitespace-nowrap rounded-md bg-primary-500 px-5 py-2.5 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600 md:inline-block"
            >
              Enroll Now
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-background-200 text-foreground-800 lg:hidden"
            >
              <i className={mobileOpen ? "ri-close-line text-xl" : "ri-menu-3-line text-xl"} aria-hidden="true" />
            </button>
          </div>
        </div>

        {coursesOpen ? (
          <div className="absolute left-1/2 top-full z-50 hidden w-[min(92vw,1080px)] -translate-x-1/2 pt-3 lg:block">
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto rounded-card border border-background-200 bg-background-50 p-6 shadow-xl">
              <div className="flex items-center justify-between gap-4 border-b border-background-200 pb-4">
                <p className="font-heading text-sm font-semibold text-foreground-950">Browse our courses</p>
                <span className="font-label text-xs uppercase tracking-wide text-foreground-500">
                  {courseColumns.reduce((total, column) => total + column.links.length, 0)} qualifications
                </span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-3">
                {courseColumns.map((column) => (
                  <div key={column.title}>
                    <p className="font-label text-xs font-semibold uppercase tracking-wider text-primary-600">
                      {column.title}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {column.links.map((link) => (
                        <li key={link.to}>
                          <Link
                            to={link.to}
                            className="block text-sm leading-snug text-foreground-700 transition-colors hover:text-primary-600"
                          >
                            {link.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-6 border-t border-background-200 pt-4">
                <Link
                  to="/our-courses"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:text-primary-700"
                >
                  View all courses
                  <i className="ri-arrow-right-line" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        {searchOpen ? (
          <div className="border-t border-background-200 bg-background-50">
            <form onSubmit={submitSearch} className="site-container flex items-center gap-3 py-3">
              <i className="ri-search-line text-lg text-foreground-500" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search courses"
                aria-label="Search courses"
                className="w-full border-none bg-transparent py-2 text-sm text-foreground-950 placeholder:text-foreground-400 focus:outline-none"
              />
              <button
                type="submit"
                className="whitespace-nowrap rounded-md bg-primary-500 px-4 py-2 text-sm font-semibold text-background-50 hover:bg-primary-600"
              >
                Search
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {mobileOpen ? (
        <div className="max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-background-200 bg-background-50 lg:hidden">
          <nav className="site-container py-4" aria-label="Mobile navigation">
            <ul className="space-y-1">
              {navigation.map((item) => (
                <li key={item.label} className="border-b border-background-100 last:border-none">
                  {item.children || item.columns ? (
                    <div>
                      <button
                        type="button"
                        onClick={() => setOpenAccordion(openAccordion === item.label ? null : item.label)}
                        aria-expanded={openAccordion === item.label}
                        className="flex w-full items-center justify-between py-3 text-left text-sm font-medium text-foreground-900"
                      >
                        {item.label}
                        <i
                          className={
                            openAccordion === item.label
                              ? "ri-subtract-line text-lg text-primary-600"
                              : "ri-add-line text-lg text-foreground-500"
                          }
                          aria-hidden="true"
                        />
                      </button>
                      {openAccordion === item.label ? (
                        <div className="pb-3">
                          {item.to ? (
                            <Link to={item.to} className="block py-2 text-sm font-medium text-primary-600">
                              {item.label}
                            </Link>
                          ) : null}
                          {item.columns
                            ? item.columns.map((column) => (
                                <div key={column.title} className="mt-2">
                                  <p className="font-label text-[11px] font-semibold uppercase tracking-wider text-primary-600">
                                    {column.title}
                                  </p>
                                  <ul className="mt-1 space-y-1">
                                    {column.links.map((link) => (
                                      <li key={link.to}>
                                        <Link to={link.to} className="block py-1.5 text-sm text-foreground-600">
                                          {link.label}
                                        </Link>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))
                            : (item.children ?? []).map((child) => (
                                <Link key={child.to} to={child.to} className="block py-2 text-sm text-foreground-600">
                                  {child.label}
                                </Link>
                              ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <Link to={item.to ?? "/"} className="block py-3 text-sm font-medium text-foreground-900">
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-col gap-3">
              <Link
                to="/agency/login"
                className="flex items-center justify-center gap-2 rounded-md border border-primary-300 bg-primary-50 px-5 py-3 text-center text-sm font-semibold text-primary-700"
              >
                <i className="ri-user-3-line text-base" aria-hidden="true" />
                Agency Portal
              </Link>
              <Link
                to="/enroll-now"
                className="rounded-md bg-primary-500 px-5 py-3 text-center text-sm font-semibold text-background-50"
              >
                Enroll Now
              </Link>
              <Link
                to="/admin/login"
                className="rounded-md border border-background-300 px-5 py-3 text-center text-sm font-semibold text-foreground-800"
              >
                Sign In
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}