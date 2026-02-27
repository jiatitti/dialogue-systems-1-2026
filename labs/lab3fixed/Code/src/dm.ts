import { assign, createActor, setup } from "xstate";
import type { Settings } from "speechstate";
import { speechstate } from "speechstate";
import { createBrowserInspector } from "@statelyai/inspect";
import { KEY } from "./azure";
import type { DMContext, DMEvents } from "./types";

const inspector = createBrowserInspector();

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: "northeurope",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

interface GrammarEntry {
  person?: string;
  day?: string;
  time?: string;
}

const grammar: { [index: string]: GrammarEntry } = {
  vlad: { person: "Vladislav Maraev" },
  bora: { person: "Bora Kara" },
  tal: { person: "Talha Bedir" },
  tom: { person: "Tom Södahl Bladsjö" },
  alice: { person: "Alice Joy" },
  bob: { person: "Bob Williams" },
  monday: { day: "Monday" },
  tuesday: { day: "Tuesday" },
  wednesday: { day: "Wednesday" },
  thursday: { day: "Thursday" },
  friday: { day: "Friday" },
  "10": { time: "10:00" },
  "11": { time: "11:00" },
  "13": { time: "13:00" },
  "14": { time: "14:00" },
  "15": { time: "15:00" },
};
const yesOrNoGrammar: { [index: string]: boolean } = {
  yes: true,
  yeah: true,
  yep: true,
  "of course": true,
  sure: true,
  no: false,
  nope: false,
  "no way": false,
  never: false,
};

// function isInGrammar(utterance: string) {
//   return utterance.toLowerCase() in grammar;
// }

function getPerson(utterance: string) {
  const lowerUtt = utterance.toLowerCase();
  const matchKey = Object.keys(grammar).find((key) => lowerUtt.includes(key));

  if (matchKey) {
    return grammar[matchKey].person;
  }
  return undefined;
}

function getDay(utterance: string) {
  return (grammar[utterance.toLowerCase()] || {}).day;
}

function getTime(utterance: string) {
  return (grammar[utterance.toLowerCase()] || {}).time;
}

function getYesNo(utterance: string): boolean | undefined {
  return yesOrNoGrammar[utterance.toLowerCase()];
}

const dmMachine = setup({
  types: {
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    "spst.speak": ({ context }, params: { utterance: string }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: params.utterance,
        },
      }),
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
      }),
  },
  guards: {
    isValidPerson: ({ context }) =>
      !!getPerson(context.lastResult?.[0]?.utterance || ""),
    isValidDay: ({ context }) =>
      !!getDay(context.lastResult?.[0]?.utterance || ""),
    isValidTime: ({ context }) =>
      !!getTime(context.lastResult?.[0]?.utterance || ""),
    isYes: ({ context }) =>
      getYesNo(context.lastResult?.[0]?.utterance || "") === true,
    isNo: ({ context }) =>
      getYesNo(context.lastResult?.[0]?.utterance || "") === false,
  },
}).createMachine({
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    lastResult: null,
    person: undefined,
    day: undefined,
    time: undefined,
    isWholeDay: undefined,
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: { CLICK: "MakeApp" },
    },
    MakeApp: {
      on: {
        RECOGNISED: {
          actions: assign(({ event }) => ({ lastResult: event.value })),
        },
        ASR_NOINPUT: { actions: assign({ lastResult: null }) },
      },
      initial: "Greeting",
      states: {
        Greeting: {
          entry: [
            {
              type: "spst.speak",
              params: { utterance: "Let's create an appointment." },
            },
            assign({
              person: undefined,
              day: undefined,
              time: undefined,
              isWholeDay: undefined,
            }),
          ],
          on: { SPEAK_COMPLETE: "AskPerson" },
        },
        AskPerson: {
          initial: "Prompt",
          states: {
            Prompt: {
              entry: {
                type: "spst.speak",
                params: { utterance: `Who are you meeting with?` },
              },
              on: { SPEAK_COMPLETE: "Listen" },
            },
            Listen: {
              entry: {
                type: "spst.listen",
              },
              on: {
                LISTEN_COMPLETE: {
                  target: "Process",
                },
              },
            },
            Process: {
              always: [
                {
                  guard: "isValidPerson",
                  target: "#DM.MakeApp.AskDay",
                  actions: assign({
                    person: ({ context }) =>
                      getPerson(context.lastResult![0].utterance),
                  }),
                },
                { target: "Prompt" },
              ],
            },
          },
        },
        AskDay: {
          initial: "Prompt",
          states: {
            Prompt: {
              entry: {
                type: "spst.speak",
                params: { utterance: `On which day is your meeting?` },
              },
              on: { SPEAK_COMPLETE: "Listen" },
            },
            Listen: {
              entry: {
                type: "spst.listen",
              },
              on: {
                LISTEN_COMPLETE: { target: "Process" },
              },
            },
            Process: {
              always: [
                {
                  guard: "isValidDay",
                  target: "#DM.MakeApp.AskWholeDay",
                  actions: assign({
                    day: ({ context }) =>
                      getDay(context.lastResult![0].utterance),
                  }),
                },
                { target: "Prompt" },
              ],
            },
          },
        },
        AskWholeDay: {
          initial: "Prompt",
          states: {
            Prompt: {
              entry: {
                type: "spst.speak",
                params: { utterance: `Will it take the whole day?` },
              },
              on: { SPEAK_COMPLETE: "Listen" },
            },
            Listen: {
              entry: {
                type: "spst.listen",
              },
              on: {
                LISTEN_COMPLETE: {
                  target: "Process",
                },
              },
            },
            Process: {
              always: [
                {
                  guard: "isYes",
                  target: "#DM.MakeApp.ConfirmApp",
                  actions: assign({ isWholeDay: true, time: undefined }),
                },
                {
                  guard: "isNo",
                  target: "#DM.MakeApp.AskTime",
                  actions: assign({ isWholeDay: false }),
                },
                { target: "Prompt" },
              ],
            },
          },
        },
        AskTime: {
          initial: "Prompt",
          states: {
            Prompt: {
              entry: {
                type: "spst.speak",
                params: { utterance: "What time is your meeting?" },
              },
              on: { SPEAK_COMPLETE: "Listen" },
            },
            Listen: {
              entry: { type: "spst.listen" },
              on: {
                LISTEN_COMPLETE: {
                  target: "Process",
                },
              },
            },
            Process: {
              always: [
                {
                  guard: "isValidTime",
                  target: "#DM.MakeApp.ConfirmApp",
                  actions: assign({
                    time: ({ context }) =>
                      getTime(context.lastResult![0].utterance),
                  }),
                },
                { target: "Prompt" },
              ],
            },
          },
        },
        ConfirmApp: {
          initial: "Prompt",
          states: {
            Prompt: {
              entry: {
                type: "spst.speak",
                params: ({ context }) => {
                  const utterance = context.isWholeDay
                    ? `Do you want me to create an appointment with ${context.person} on ${context.day} for the whole day?`
                    : `Do you want me to create an appointment with ${context.person} on ${context.day} at ${context.time}?`;
                  return { utterance };
                },
              },
              on: { SPEAK_COMPLETE: "Listen" },
            },
            Listen: {
              entry: { type: "spst.listen" },
              on: {
                LISTEN_COMPLETE: {
                  target: "Process",
                },
              },
            },
            Process: {
              always: [
                {
                  guard: "isYes",
                  target: "#DM.MakeApp.AppointmentCreated",
                },
                {
                  guard: "isNo",
                  target: "#DM.MakeApp.AskPerson",
                  actions: assign({
                    person: undefined,
                    day: undefined,
                    time: undefined,
                    isWholeDay: undefined,
                  }),
                },
                { target: "Prompt" },
              ],
            },
          },
        },
        AppointmentCreated: {
          entry: {
            type: "spst.speak",
            params: { utterance: "Your appointment has been created!" },
          },
          on: { SPEAK_COMPLETE: "#DM.Done" },
        },
      },
    },
    Done: {
      on: {
        CLICK: "MakeApp",
      },
    },
  },
});

const dmActor = createActor(dmMachine, {
  inspect: inspector.inspect,
}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta(),
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
