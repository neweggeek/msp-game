import { formatTime } from "../../engine";
import { data, useGame, useUi } from "../store";
import { Terminal } from "../terminal/Terminal";

/**
 * ScreenLink Support: a one-time session. Make a join code, call someone at the client, and
 * have them type it in and click Allow. The shell lasts until they leave.
 */
export function ScreenLinkPage() {
  const game = useGame();
  const { act, setDialog } = useUi();
  const fmt = (m: number) => formatTime(data.calendar, m);
  const invites = [...(game.screenlink ?? [])].reverse();
  const now = game.clock.now;
  return (
    <main className="main">
      <section className="col">
        <section className="panel">
          <header>
            <h2>ScreenLink Support</h2>
            <span className="sub">One-time sessions</span>
          </header>
          <div className="body">
            <p className="dim" style={{ marginTop: 0 }}>
              Make a join code, then call someone at the client. They open the ScreenLink support
              page, type the code and click Allow. You get a shell on the PC they sit at until they
              leave. No agent needed, and they are there, so no consent problem.
            </p>
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => act({ t: "sl-new" })}>
                New support session
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setDialog({ kind: "phone" })}
                title="Call someone to read them the code"
              >
                Call the client
              </button>
            </div>
          </div>
        </section>
        <section className="panel grow">
          <header>
            <h2>Sessions</h2>
          </header>
          <table className="grid">
            <tbody>
              {invites.map((s) => {
                const live = s.until !== undefined && now < s.until;
                return (
                  <tr key={s.code}>
                    <td className="mono">{s.code}</td>
                    <td className="dim">made {fmt(s.createdAt)}</td>
                    <td>
                      {!s.deviceId
                        ? "Waiting for someone to join"
                        : live
                          ? `${s.person} on ${game.world.devices.find((d) => d.id === s.deviceId)?.hostname}, until about ${fmt(s.until ?? now)}`
                          : `${s.person} left`}
                    </td>
                    <td>
                      {live && (
                        <button
                          type="button"
                          className="btn small primary"
                          onClick={() => act({ t: "sl-open", code: s.code })}
                        >
                          Open shell
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {invites.length === 0 && (
                <tr>
                  <td className="dim">No sessions yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
      <section className="col">
        <section className="panel grow">
          <Terminal />
        </section>
      </section>
    </main>
  );
}
