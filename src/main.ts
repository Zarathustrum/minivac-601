import demoDocument from '../data/demo-library.json';
import netlistText from '../data/netlist.json?raw';
import assetDocument from '../data/public-assets.json';
import idealProfileDocument from '../data/profiles/MV601-IDEAL.json';
import profileDocument from '../data/profiles/MV601-REF-A.json';
import { createMachine } from './core/machine.ts';
import { loadNetlist } from './core/netlist.ts';
import { loadProfile } from './core/profile.ts';
import { loadDemoLibrary } from './demo-library.ts';
import { createDemoSession } from './session.ts';
import { createAudioRouter, safePreferenceStorage } from './ui/audio-router.ts';
import {
  createDemoExperience,
  type DemoExperienceView,
  type DemoProfileId,
} from './ui/demo-experience.ts';
import { mountInspector, type InspectorNetlist } from './ui/inspector.ts';
import { createHelpCredits } from './ui/help-credits.ts';
import { createWebAudioBackend } from './web-audio.ts';

const bytes = new TextEncoder().encode(netlistText);
const netlist = loadNetlist(bytes);
const profiles = [loadProfile(profileDocument), loadProfile(idealProfileDocument)];
const demos = loadDemoLibrary(demoDocument, netlist);
const rawView = JSON.parse(netlistText) as InspectorNetlist;
const MANUAL_SESSION = Object.freeze({ id: 'MANUAL', commands: Object.freeze([]) });
const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('inspector: missing #app mount point');

function demoById(id: string) {
  const demo = demos.demos.find((candidate) => candidate.id === id);
  if (demo === undefined) throw new Error('main: unknown demo ' + JSON.stringify(id));
  return demo;
}

let selectedDemo = demos.demos[0]!;
let selectedProfile: DemoProfileId = 'MV601-REF-A';
let selectedManual = false;
let experience: DemoExperienceView;
const preferences = safePreferenceStorage(() => window.localStorage);
const audio = createAudioRouter(
  document,
  createWebAudioBackend(),
  preferences,
  (error) => {
    console.error('audio:', error);
  },
);
const help = createHelpCredits(document, preferences, assetDocument.records);
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    help.dispose();
    audio.dispose();
  }
});
const session = createDemoSession({
  profileId: selectedProfile,
  createMachine(profileId) {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (profile === undefined) throw new Error('main: unknown profile ' + JSON.stringify(profileId));
    return createMachine(netlist, profile);
  },
  mount(machine, context) {
    const manual = context.demoId === MANUAL_SESSION.id;
    const demo = manual ? null : demoById(context.demoId);
    return mountInspector(root, machine, rawView, {
      experience: experience.element,
      controlLabels: demo?.controlLabels ?? {},
      audio,
      help,
      startWithFreeCord: !manual,
    });
  },
});
experience = createDemoExperience(document, {
  demos: demos.demos,
  demoId: selectedDemo.id,
  profileId: selectedProfile,
  callbacks: {
    onDemoSelect(demoId) {
      const demo = demoById(demoId);
      session.loadDemo(demo);
      selectedDemo = demo;
      selectedManual = false;
      experience.update({ demoId: selectedDemo.id, profileId: selectedProfile, manual: false });
    },
    onManual() {
      session.loadDemo(MANUAL_SESSION);
      selectedManual = true;
      experience.update({ demoId: selectedDemo.id, profileId: selectedProfile, manual: true });
    },
    onReset() {
      session.reset();
      experience.update({
        demoId: selectedDemo.id,
        profileId: selectedProfile,
        manual: selectedManual,
      });
    },
    onProfileSelect(profileId) {
      session.switchProfile(profileId);
      selectedProfile = profileId;
      experience.update({
        demoId: selectedDemo.id,
        profileId: selectedProfile,
        manual: selectedManual,
      });
    },
  },
});
session.loadDemo(selectedDemo);
if (help.initiallyOpen) help.open();
