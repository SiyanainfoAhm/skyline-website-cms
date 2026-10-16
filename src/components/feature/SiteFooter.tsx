import { Link } from "react-router-dom";
import { usePublicSite } from "@/hooks/usePublicSite";

export default function SiteFooter() {
  const { data } = usePublicSite();
  const { footer, footerLinks, studentLinks, settings } = data;

  return (
    <footer className="mt-auto">
      {footer.showAcknowledgement ? (
        <div className="border-t border-background-200 bg-background-100">
          <div className="site-container flex flex-col items-start gap-4 py-6 md:flex-row md:items-center">
            <img
              src="https://slit.edu.au/wp-content/uploads/2023/09/slit-c.png"
              alt={settings.logoAlt}
              className="h-12 w-auto shrink-0 object-contain md:h-14"
            />
            <p className="text-xs leading-relaxed text-foreground-600 md:text-sm">{footer.acknowledgement}</p>
          </div>
        </div>
      ) : null}

      <div className="bg-accent-950 text-background-100">
        <div className="site-container grid grid-cols-1 gap-10 py-14 sm:grid-cols-2 lg:grid-cols-12 lg:gap-8">
          <div className="sm:col-span-2 lg:col-span-4">
            <img
              src="https://slit.edu.au/wp-content/uploads/2023/06/footer-logo.png"
              alt={settings.logoAlt}
              className="h-12 w-auto object-contain"
            />
            <h2 className="mt-6 font-heading text-base font-semibold text-background-50">About Us</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-background-200">{footer.about}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {settings.social.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-background-50/10 text-background-100 transition-colors hover:bg-primary-500 hover:text-background-50"
                >
                  <i className={`${social.icon} text-base`} aria-hidden="true" />
                </a>
              ))}
            </div>
            {settings.legal ? (
              <p className="mt-5 font-label text-sm font-semibold tracking-wide text-background-200">{settings.legal}</p>
            ) : null}
          </div>

          <div className="lg:col-span-2 lg:col-start-6">
            <h2 className="font-heading text-base font-semibold text-background-50">{footer.quickLinksTitle}</h2>
            <ul className="mt-4 space-y-2.5">
              {footerLinks.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-background-200 transition-colors hover:text-primary-300">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2">
            <h2 className="font-heading text-base font-semibold text-background-50">{footer.studentLinksTitle}</h2>
            <ul className="mt-4 space-y-2.5">
              {studentLinks.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-background-200 transition-colors hover:text-primary-300">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <h2 className="font-heading text-base font-semibold text-background-50">Contact</h2>
            <ul className="mt-4 space-y-3 text-sm text-background-200">
              <li className="flex items-start gap-3">
                <i className="ri-map-pin-line mt-0.5 text-base text-primary-300" aria-hidden="true" />
                <span>{settings.address}</span>
              </li>
              <li className="flex items-center gap-3">
                <i className="ri-phone-line text-base text-primary-300" aria-hidden="true" />
                <a href={settings.phoneHref} className="transition-colors hover:text-primary-300">
                  {settings.phone}
                </a>
              </li>
              <li className="flex items-center gap-3">
                <i className="ri-mail-line text-base text-primary-300" aria-hidden="true" />
                <a href={settings.emailHref} className="transition-colors hover:text-primary-300">
                  {settings.email}
                </a>
              </li>
            </ul>
            <Link
              to="/enroll-now"
              className="mt-6 inline-block whitespace-nowrap rounded-md bg-primary-500 px-5 py-2.5 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600"
            >
              Enroll Now
            </Link>
          </div>
        </div>

        <div className="border-t border-background-50/10">
          <div className="site-container flex flex-col items-center justify-center gap-2 py-5 md:flex-row">
            <p className="text-xs text-background-300">{footer.copyright}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}