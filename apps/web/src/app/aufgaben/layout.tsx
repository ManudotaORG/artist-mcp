/**
 * The task view keeps the site's colours but reads in the "Lesen" type
 * (globals.css): proportional, sentence case, for a long list on a phone.
 */
const AufgabenLayout = ({ children }: LayoutProps<'/aufgaben'>) => (
  <div className="skin-lesen flex-1">{children}</div>
);

export default AufgabenLayout;
