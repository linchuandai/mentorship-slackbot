const Moniker = require("moniker");

const Text = require("../text");

const message = require("../actions/message");
const { getMentorRequestChannelId } = require("../actions/channel");

const { web } = require("../clients");

const {
  getSession,
  clearSession,
  getUserIdByThreadTs,
  updateSession
} = require("../db");

const handleNeedMentor = (payload, respond) => {
  // check for existing session
  const session = getSession(payload.user.id);
  if (session.ts != null) {
    respond({
      text: Text.SESSION_ALREADY_ACTIVE
    });
  } else {
    // send problem prompt text
    message.openMentorRequestDialog(payload.trigger_id, payload.message.ts);
  }
};

const handleMentorRequest = payload => {
  const { user, channel, submission, state } = payload;
  const session = updateSession(user.id, {
    username: user.name,
    channel: channel.id,
    mentee_ts: state,
    submission
  });
  message
    .postMentorRequest(session)
    .then(({ ts }) =>
      message.confirmMentorRequest(updateSession(user.id, { ts }))
    );
};

const handleCancelRequest = ({ user: { id } }, respond) => {
  respond({
    text: "Your request was canceled"
  });
  const { channel, ts } = getSession(id);
  web.chat.delete({ channel: getMentorRequestChannelId(), ts });
  clearSession(id);
  message.needMentor(channel);

  // respond in private mentor channel
};

const handleClaimRequest = payload => {
  const userId = getUserIdByThreadTs(payload.message.ts);
  const session = updateSession(userId, { mentor: payload.user.id });

  // create group, prevent dup channel names
  const hash = Math.round(new Date().getTime() / 1000)
    .toString()
    .slice(-6);

  web.conversations
    .open({
      users: [session.id, session.mentor].join(",")
    })
    .then(response => {
      const groupId = response.channel.id;
      message
        .sessionIntroduction(updateSession(session.id, { group_id: groupId }))
        .then(({ ts, channel }) =>
          updateSession(userId, {
            mentor_claim_ts: ts,
            mentor_channel: channel
          })
        );
    });
};

const handleDeleteRequest = payload => {
  const userId = payload.actions[0].value;
  const session = getSession(userId);
  web.chat.delete({
    channel: getMentorRequestChannelId(),
    ts: session.ts
  });
  if (session.group_id != null) {
    web.conversations.close({ channel: session.group_id });
  }
  message.postSessionDeleted(session);
  clearSession(userId);
};

const handleSurrenderRequest = payload => {
  const userId = payload.actions[0].value;
  const session = getSession(userId);
  message.sessionSurrendered(session).then(() => {
    console.log(session.group_id);
    web.conversations.close({ channel: session.group_id });
    updateSession(userId, {
      mentor_claim_ts: undefined,
      group_id: undefined,
      mentor: undefined
    });
  });
};

const handleCompleteRequest = payload => {
  const userId = payload.actions[0].value;
  const session = getSession(userId);
  message.sessionCompleted(session).then(() => {
    web.conversations.close({ channel: session.group_id });
    clearSession(userId);
  });
};

const bootstrap = interactions => {
  interactions.action({ actionId: "need_mentor" }, handleNeedMentor);
  interactions.action({ callbackId: "mentor_request" }, handleMentorRequest);
  interactions.action({ actionId: "cancel_request" }, handleCancelRequest);
  interactions.action({ actionId: "claim_request" }, handleClaimRequest);
  interactions.action({ actionId: "delete_request" }, handleDeleteRequest);
  interactions.action(
    { actionId: "surrender_request" },
    handleSurrenderRequest
  );
  interactions.action({ actionId: "complete_request" }, handleCompleteRequest);
};

module.exports = { bootstrap };
