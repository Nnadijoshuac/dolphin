/**
 * A number whose digits roll to their new value (owner, 2026-10-17: "just roll to the new value").
 *
 * Each digit is a column of 0-9 moved into place, so a change slides rather than blinks. Columns are
 * keyed from the RIGHT, so $9.99 -> $10.01 keeps the cents columns and adds one on the left. The first
 * render does not animate; only a change does. Screen readers get the plain value once.
 */
export function RollingFigure({ value }: { value: string }) {
  const chars = Array.from(value);
  return (
    <span className="roll">
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="roll__face">
        {chars.map((ch, index) => {
          const key = chars.length - index;
          return /\d/.test(ch) ? (
            <span className="roll__col" key={key}>
              <span className="roll__strip" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
                {DIGITS.map((digit) => (
                  <span key={digit}>{digit}</span>
                ))}
              </span>
            </span>
          ) : (
            <span className="roll__char" key={key}>
              {ch}
            </span>
          );
        })}
      </span>
    </span>
  );
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
