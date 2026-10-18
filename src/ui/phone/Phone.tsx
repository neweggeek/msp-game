import { type ReactNode, useEffect, useRef, useState } from "react";
import { ispLines, people, teamLines, unlockedFixes } from "../../engine";
import { data, useGame, useUi } from "../store";

type ModalProps = { title: string; children: ReactNode; footer: ReactNode };

/**
 * The phone. Pick who to call, then ask questions or give remote hands tasks one at a time.
 * Device tasks name a device from the docs, so a stale or missing entry shows up here too.
 */
export function PhoneDialog({
  Modal,
  ticket,
  call,
}: {
  Modal: (p: ModalProps) => ReactNode;
  ticket?: string;
  call?: string;
}) {
  const game = useGame();
  const { act, setDialog } = useUi();
  const t = ticket ? game.book.tickets.find((x) => x.id === ticket) : undefined;
  const who = [...people(game.world, t?.contact), ...ispLines(game.world), ...teamLines(data)];
  const c = call ? game.calls?.[call] : undefined;
  const person = c ? who.find((p) => p.id === c.person) : undefined;
  const trap = data.calls.traps.list.find((x) => x.id === c?.trap?.id);
  const docs = [...game.world.docs.devices].sort((a, b) => a.hostname.localeCompare(b.hostname));
  const [device, setDevice] = useState(docs[0]?.deviceId ?? "");
  const end = useRef<HTMLDivElement>(null);
  const lines = c?.transcript.length ?? 0;
  useEffect(() => {
    if (lines > 0) end.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const dial = (id: string) => {
    const r = act({ t: "call", person: id, ...(ticket ? { ticket } : {}) });
    if (r.session) setDialog({ kind: "phone", ...(ticket ? { ticket } : {}), call: r.session });
  };
  const ask = (id: string, needsDevice?: boolean) => {
    if (!c) return;
    act({ t: "call-ask", call: c.id, ask: id, ...(needsDevice ? { device } : {}) });
  };
  const hangUp = () => {
    if (c && !c.closed) act({ t: "call-end", call: c.id });
    setDialog({ kind: "phone", ...(ticket ? { ticket } : {}) });
  };

  if (!c)
    return (
      <Modal
        title={t ? `Call about ${t.id}` : "Call the client"}
        footer={
          <button type="button" className="btn" onClick={() => setDialog(null)}>
            Close
          </button>
        }
      >
        <p className="dim" style={{ marginTop: 0 }}>
          A quick call can settle a question, test a fix with the client, or put someone's hands on
          the gear. Calls only get answered during the client's business hours. The ISP support
          lines answer all hours, after a wait on hold, and want the account number and PIN. Your
          team picks up during MSP hours.
          {game.world.client.contactPreference === "scheduled-only" &&
            " This client asked for calls to be scheduled through dispatch."}
        </p>
        <table className="grid">
          <tbody>
            {who.map((p) => {
              const contact = game.world.client.contacts.find((x) => x.id === p.id);
              const isp = game.world.docs.sites.find((s) => s.siteId === p.isp);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="dim">
                    {contact
                      ? contact.role
                      : isp
                        ? `ISP for ${isp.name}`
                        : p.team
                          ? "Your team"
                          : `On ${t?.id}`}
                  </td>
                  <td className="mono dim">{contact?.phone ?? isp?.isp.phone ?? ""}</td>
                  <td>
                    <button type="button" className="btn small" onClick={() => dial(p.id)}>
                      Call
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Modal>
    );

  const fixes = person?.isp || person?.team ? [] : unlockedFixes(game.world, game.heard ?? []);
  const ispSite = game.world.docs.sites.find((s) => s.siteId === person?.isp);
  const deviceName = docs.find((d) => d.deviceId === device)?.hostname ?? "it";
  const live = !c.closed;
  return (
    <Modal
      title={`${live ? "On the phone with" : "Call ended:"} ${person?.name ?? ""}`}
      footer={
        <button type="button" className={`btn ${live ? "" : "primary"}`} onClick={hangUp}>
          {live ? "Hang up" : "Back"}
        </button>
      }
    >
      <div className="call-log">
        {c.transcript.map((l, i) => (
          <div key={`${i}-${l}`} className={l.startsWith("You:") ? "me" : ""}>
            {l}
          </div>
        ))}
        <div ref={end} />
      </div>
      {live && trap && c.trap?.answer === undefined && (
        <div className="call-asks" style={{ marginTop: 8 }}>
          <span className="dim">Answer them:</span>
          {trap.answers.map((ans, i) => (
            <button
              key={ans.text}
              type="button"
              className="btn small"
              onClick={() => act({ t: "call-answer", call: c.id, answer: i })}
            >
              {ans.text}
            </button>
          ))}
        </div>
      )}
      {live && (
        <>
          {!ispSite && (
            <div className="actions" style={{ margin: "10px 0 6px" }}>
              <span className="dim">Device:</span>
              <select
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                aria-label="Device to ask about"
              >
                {docs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.hostname}
                    {d.ip ? ` (${d.ip})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="call-asks">
            {ispSite &&
              data.calls.isp.asks.map((a) => (
                <button key={a.id} type="button" className="btn small" onClick={() => ask(a.id)}>
                  {a.label.replaceAll("{site}", ispSite.name)}
                </button>
              ))}
            {person?.team &&
              data.calls.team.asks.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="btn small"
                  onClick={() => ask(a.id, true)}
                >
                  {a.label.replaceAll("{device}", deviceName)}
                </button>
              ))}
            {!ispSite &&
              !person?.team &&
              data.calls.asks
                .filter((a) => !a.ticket || t)
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="btn small"
                    onClick={() => ask(a.id, a.device)}
                  >
                    {a.label.replaceAll("{device}", deviceName)}
                  </button>
                ))}
            {fixes.map((f) => (
              <button
                key={f.id}
                type="button"
                className="btn small primary"
                onClick={() => ask(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
