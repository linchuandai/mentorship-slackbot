import * as db from "db";
import { runnable, interval } from "date";

import { rescan } from "./users";
import * as message from "./message";

const bumpSessions = () => {
  const sessions = db.getSessionsToBump();
  sessions.map(message.bumpMentorRequest);
};

export const stats = () => {
  if (!runnable()) return;
  const created = db.getCreated();
  const online = db.getOnline();
  message.stats({
    created,
    online
  });
};

export const init = () => {
  // bump dead requests every 30s
  interval(bumpSessions, 30000);
  bumpSessions();

  // rescan users list every 15min
  interval(rescan, 1000 * 60 * 15);
  rescan();

  // send stats every 3 hours
  interval(stats, 1000 * 60 * 60 * 3);
};

export { runnable };