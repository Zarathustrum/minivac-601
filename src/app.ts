import demoDocument from '../data/demo-library.json';
import netlistText from '../data/netlist.json?raw';
import assetDocument from '../data/public-assets.json';
import idealProfileDocument from '../data/profiles/MV601-IDEAL.json';
import profileDocument from '../data/profiles/MV601-REF-A.json';
import type { Machine } from './core/contract.ts';
import { createMachine } from './core/machine.ts';
import { loadNetlist, type LoadedNetlist } from './core/netlist.ts';
import { loadProfile, type Profile } from './core/profile.ts';
import { loadDemoLibrary } from './demo-library.ts';
import { createDemoSession } from './session.ts';
import { createAudioRouter, safePreferenceStorage } from './ui/audio-router.ts';
import {
  createDemoExperience,
  DEMO_PROFILE_IDS,
  type DemoExperienceView,
  type DemoProfileId,
} from './ui/demo-experience.ts';
import { mountInspector, type InspectorNetlist } from './ui/inspector.ts';
import { createHelpCredits } from './ui/help-credits.ts';
import { createWebAudioBackend } from './web-audio.ts';

/** The running console, for a caller that brings its own machine. */
export interface App {
  /** The netlist and profiles the page loaded; an adopted machine is built from these. */
  readonly netlist: LoadedNetlist;
  readonly profiles: readonly Profile[];
  /**
   * Show `machine` frozen and locked, as a blank manual panel on its own profile: no replay, no
   * tick, no command. Call it again after each change so the cords re-render. Until `release`,
   * the demo, manual, reset and profile controls do nothing.
   */
  adopt(machine: Machine): void;
  /** Remount the adopted machine as it stands, live and unlocked, and hand the controls back. */
  release(): void;
}

/** Compose the web console in `#app`: the whole of the public page. */
export function startApp(): App {
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
    if (demo === undefined) throw new Error('app: unknown demo ' + JSON.stringify(id));
    return demo;
  }

  function profileOf(machine: Machine): DemoProfileId {
    const id = machine.snapshot().profileId;
    const known = DEMO_PROFILE_IDS.find((candidate) => candidate === id);
    if (known === undefined) throw new Error('app: unknown profile ' + JSON.stringify(id));
    return known;
  }

  let selectedDemo = demos.demos[0]!;
  let selectedProfile: DemoProfileId = 'MV601-REF-A';
  let selectedManual = false;
  /** While set, the machine belongs to the caller of `adopt` and the demo controls are ignored. */
  let adopted: Machine | null = null;
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
      if (profile === undefined) throw new Error('app: unknown profile ' + JSON.stringify(profileId));
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
        frozen: context.frozen === true,
        locked: context.locked === true,
      });
    },
  });
  experience = createDemoExperience(document, {
    demos: demos.demos,
    demoId: selectedDemo.id,
    profileId: selectedProfile,
    callbacks: {
      onDemoSelect(demoId) {
        if (adopted !== null) return;
        const demo = demoById(demoId);
        session.loadDemo(demo);
        selectedDemo = demo;
        selectedManual = false;
        experience.update({ demoId: selectedDemo.id, profileId: selectedProfile, manual: false });
      },
      onManual() {
        if (adopted !== null) return;
        session.loadDemo(MANUAL_SESSION);
        selectedManual = true;
        experience.update({ demoId: selectedDemo.id, profileId: selectedProfile, manual: true });
      },
      onReset() {
        if (adopted !== null) return;
        session.reset();
        experience.update({
          demoId: selectedDemo.id,
          profileId: selectedProfile,
          manual: selectedManual,
        });
      },
      onProfileSelect(profileId) {
        if (adopted !== null) return;
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

  return Object.freeze({
    netlist,
    profiles,
    adopt(machine: Machine): void {
      const profileId = profileOf(machine);
      session.adopt(machine, { demo: MANUAL_SESSION, profileId, frozen: true, locked: true });
      adopted = machine;
      selectedManual = true;
      selectedProfile = profileId;
      experience.update({ demoId: selectedDemo.id, profileId, manual: true });
    },
    release(): void {
      const machine = adopted;
      if (machine === null) return;
      adopted = null;
      // Reset and profile switches afterwards start a blank manual panel, as the drawer shows.
      session.adopt(machine, {
        demo: MANUAL_SESSION,
        profileId: selectedProfile,
        frozen: false,
        locked: false,
      });
    },
  });
}
