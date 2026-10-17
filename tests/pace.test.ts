import { describe, expect, it } from "vitest";
import { paceDelays } from "../src/ui/terminal/pace";

describe("terminal pacing", () => {
  it("spaces Windows ping replies a second apart and makes timeouts wait", () => {
    const ok = paceDelays([
      "",
      "Pinging 10.20.0.5 with 32 bytes of data:",
      "Reply from 10.20.0.5: bytes=32 time=18ms TTL=128",
      "Reply from 10.20.0.5: bytes=32 time=18ms TTL=128",
      "",
      "Ping statistics for 10.20.0.5:",
    ]);
    expect(ok).toEqual([0, 0, 300, 1000, 0, 0]);
    const fail = paceDelays(["Request timed out.", "Request timed out."]);
    expect(fail).toEqual([4000, 4000]);
  });

  it("holds a failed Unix ping until its statistics", () => {
    expect(
      paceDelays([
        "PING 8.8.8.8 (8.8.8.8): 56 data bytes",
        "",
        "--- 8.8.8.8 ping statistics ---",
        "5 packets transmitted, 0 packets received, 100% packet loss",
      ]),
    ).toEqual([0, 0, 5000, 0]);
  });

  it("paces traceroute hops and DNS timeouts", () => {
    expect(
      paceDelays([
        "  1    1 ms    1 ms    2 ms  10.20.0.1",
        "  2     *        *        *     Request timed out.",
        " 1  10.20.0.1  1.300 ms",
        " 2  *  * ms",
        "DNS request timed out.",
      ]),
    ).toEqual([400, 3000, 400, 3000, 2000]);
  });
});
