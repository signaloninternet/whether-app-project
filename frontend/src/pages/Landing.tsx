import { Link } from "react-router-dom";
import { EXAMPLES } from "../components/plan/PlanForm";
import { Icon } from "../components/ui/Icon";
import { tripToSearch } from "../lib/shareUrl";
import styles from "./landing.module.css";

const CARDS = [
  { title: "Crosswinds", art: styles.artWind, example: EXAMPLES[1] },
  { title: "Storm belts", art: styles.artRain, example: EXAMPLES[3] },
  { title: "Mountain snow", art: styles.artSnow, example: EXAMPLES[2] },
  { title: "Coast to coast", art: styles.artLong, example: EXAMPLES[4] },
];

function exampleLink(ex: (typeof EXAMPLES)[number]): string {
  return `/plan${tripToSearch({
    origin: ex.origin, destination: ex.destination, departure: null, timezone: null,
    loadLb: 42_000, intervalMi: 25, hos: false, routeId: null,
  })}`;
}

export function Landing() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.wordmark} aria-label="Routecast">routecast</Link>
        <nav className={styles.nav}>
          <a href="#how">How it works</a>
          <Link to="/plan">Planner</Link>
          <Link to="/plan" className={styles.navButton}>
            <Icon name="route" size={16} /> Plan a route
          </Link>
        </nav>
      </header>

      <main className={styles.main}>
        <h1 className={styles.headline}>The safest way<br />to haul through weather.</h1>
        <p className={styles.lede}>
          Routecast compares three real truck routes against the hour-by-hour forecast at every checkpoint,
          and recommends the one with the fewest severe-weather miles.
        </p>
        <Link to="/plan" className={styles.cta}>Plan a route for free</Link>

        <div className={styles.cards}>
          {CARDS.map((card) => (
            <Link key={card.title} to={exampleLink(card.example)} className={`${styles.card} ${card.art}`}>
              <span className={styles.cardLabel}>
                <span>{card.title}<small>{card.example.title}</small></span>
                <Icon name="chevronRight" size={18} />
              </span>
            </Link>
          ))}
        </div>

        <section id="how" className={styles.how}>
          {[
            ["Real truck routes", "Three options from a truck-aware router: the best route, its alternatives, and a different corridor when needed."],
            ["Forecast at arrival", "Weather is sampled every 10, 25 or 50 miles at the hour the truck gets there, not at departure."],
            ["Safest, then fastest", "Fewest No Travel, Severe and High miles win; average risk and drive time break ties."],
          ].map(([title, text]) => (
            <div key={title} className={styles.step}>
              <strong>{title}</strong>
              <span>{text}</span>
            </div>
          ))}
        </section>
      </main>
      <footer className={styles.footer}>routecast · weather-aware truck routing · data © OpenStreetMap, Open-Meteo</footer>
    </div>
  );
}
