import type { ReactNode } from "react";

interface Props {
  title: ReactNode;
  hint?: ReactNode;
  extra?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}

export default function SectionCard({ title, hint, extra, flush, children }: Props) {
  return (
    <section className="section">
      <header className="section__head">
        <div>
          <h2 className="section__title">{title}</h2>
          {hint ? <div className="section__hint">{hint}</div> : null}
        </div>
        {extra ? <div className="section__actions">{extra}</div> : null}
      </header>
      <div className={flush ? "section__body section__body--flush" : "section__body"}>
        {children}
      </div>
    </section>
  );
}
