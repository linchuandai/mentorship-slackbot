import Config from "config";

import { webClient } from "clients";
import * as db from "db";
import { handle } from "utils";

import { runnable } from "date";
import * as Message from "actions/message";

import { Session, UserID, ChannelID } from "typings";

interface Member {
  deleted: boolean;
  id: UserID;
  is_bot: boolean;
  name: string;
}

const tryWelcome = (
  member: Member,
  session: Session,
  mentorChannelIds: Set<UserID>,
  canWelcome: boolean
) => {
  if (!session.welcomed && (canWelcome || mentorChannelIds.has(member.id))) {
    return Message.Mentee.welcome(
      db.updateSession(member.id, {
        welcomed: true
      })
    );
  }
  return Promise.resolve(null);
};

// tries to add a member to our index
export const tryAdd = (
  member: Member,
  mentorChannelIds: Set<UserID>,
  canWelcome: boolean
) => {
  const session = db.getSession(member.id);
  if (!member.is_bot && session == null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return webClient.im.open({ user: member.id }).then(({ channel }: any) => {
      return tryWelcome(
        member,
        db.updateSession(member.id, {
          id: member.id,
          channel: channel.id,
          name: member.name,
          welcomed: false
        }),
        mentorChannelIds,
        canWelcome
      );
    });
  } else if (session != null) {
    return tryWelcome(member, session, mentorChannelIds, canWelcome);
  }
  return Promise.resolve(null);
};

const updateMentors = (members: Member[], mentorChannelIds: Set<UserID>) => {
  const existingMentors = db.getMentors();
  const mentors = {};
  for (const member of members) {
    if (mentorChannelIds.has(member.id)) {
      mentors[member.id] = existingMentors[member.id] || {
        skills: {}
      };
    }
  }
  db.setMentors(mentors);
  return Promise.all(
    Object.keys(mentors).map(user => webClient.users.getPresence({ user }))
  )
    .then(
      results => results.filter(({ presence }) => presence === "active").length
    )
    .then(db.setOnline);
};

export const rescan = handle(() => {
  const getMembers = (
    channel: ChannelID,
    cursor: string | undefined = undefined
  ): Promise<UserID[]> => {
    return webClient.conversations
      .members({ channel, cursor, limit: 500 })
      .then(({ members, response_metadata }) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const { next_cursor } = response_metadata!;
        if (next_cursor === "") {
          return members as UserID[];
        } else {
          return getMembers(channel, next_cursor).then(nextMembers => {
            return [...(members as UserID[]), ...nextMembers];
          });
        }
      });
  };
  const getAll = (
    cursor: string | undefined = undefined
  ): Promise<Member[]> => {
    return webClient.users
      .list({ cursor, limit: 500 })
      .then(({ members, response_metadata }) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const { next_cursor } = response_metadata!;
        const filtered_members = (members as Member[]).filter(m => !m.deleted);
        if (next_cursor === "") {
          return filtered_members;
        } else {
          return getAll(next_cursor).then(nextMembers => {
            return [...filtered_members, ...nextMembers];
          });
        }
      });
  };
  return Promise.all([getAll(), getMembers(Config.MENTOR_CHANNEL)]).then(
    ([members, _mentorChannelIds]) => {
      const mentorChannelIds = new Set(_mentorChannelIds);
      updateMentors(members, mentorChannelIds);
      const canWelcome = runnable();
      members.forEach(member => tryAdd(member, mentorChannelIds, canWelcome));
    }
  );
});
