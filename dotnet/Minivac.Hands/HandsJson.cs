using System;
using System.Collections.Generic;
using System.Text.Json;
using Minivac.Core;

namespace Minivac.Hands;

/// <summary>
/// The table's and the core's data as `JSON.stringify` prints the TypeScript objects. Every key
/// is written in the order the TypeScript object literal declares it, so the text is the text
/// `JSON.stringify` makes of the TypeScript value, byte for byte: Node re-prints parsed replies
/// (`state --json` with `JSON.stringify(snapshot, null, 2)`, the session file with
/// `JSON.stringify(step)`), and both print keys in parse order.
/// </summary>
public static class HandsJson
{
    private static readonly string[] BandNames = ["below", "hold", "above"];
    private static readonly string[] LampNames = ["off", "dim", "on"];

    /// <summary>tools/hands/session-file.ts has the file layout; this is the value as JSON.</summary>
    public static string Session(Session session)
    {
        var output = new JsonOut();
        output.BeginObject()
            .Key("schema").String(session.schema)
            .Key("profile").String(session.profile)
            .Key("contract").String(session.contract)
            .Key("netlistHash").String(session.netlistHash)
            .Key("profileHash").String(session.profileHash)
            .Key("script");
        Script(output, session.script);
        output.EndObject();
        return output.Text;
    }

    public static void Script(JsonOut output, IReadOnlyList<SessionStep> script)
    {
        output.BeginArray();
        foreach (var step in script) Step(output, step);
        output.EndArray();
    }

    public static string Step(SessionStep step)
    {
        var output = new JsonOut();
        Step(output, step);
        return output.Text;
    }

    /// <summary>table.ts:394 `{ k: 'do', cmd }`, 278 `{ k: 'advance', ms }`, 260 `{ k: 'settle', maxMs }`, 581 `{ k: 'load', program, cords }`.</summary>
    public static void Step(JsonOut output, SessionStep step)
    {
        output.BeginObject().Key("k").String(step.k);
        switch (step)
        {
            case SessionStep.Do { raw: { } raw }:
                output.Key("cmd").Element(raw);
                break;
            case SessionStep.Do { cmd: { } cmd }:
                output.Key("cmd");
                Command(output, cmd);
                break;
            case SessionStep.Advance advance:
                output.Key("ms").Number(advance.ms);
                break;
            case SessionStep.Settle settle:
                output.Key("maxMs").Number(settle.maxMs);
                break;
            case SessionStep.Load load:
                output.Key("program").String(load.program).Key("cords").Number(load.cords);
                break;
        }
        output.EndObject();
    }

    /// <summary>A command as the table's handlers build it (table.ts:407-528, 571).</summary>
    public static void Command(JsonOut output, Command cmd)
    {
        output.BeginObject().Key("k").String(cmd.k);
        switch (cmd)
        {
            case Core.Command.Power power: output.Key("on").Bool(power.on); break;
            case Core.Command.Breaker: output.Key("reset").Bool(true); break;
            case Core.Command.Connect connect:
                output.Key("cord").Number(connect.cord).Key("a");
                End(output, connect.a);
                output.Key("b");
                End(output, connect.b);
                if (connect.r_uohm is { } r) output.Key("r_uohm").Number(r);
                break;
            case Core.Command.Disconnect disconnect: output.Key("cord").Number(disconnect.cord); break;
            case Core.Command.Button button: output.Key("n").Number(button.n).Key("target").Number(button.target); break;
            case Core.Command.Switch slide: output.Key("n").Number(slide.n).Key("target").Number(slide.target); break;
            case Core.Command.RelayGrab grab: output.Key("n").Number(grab.n).Key("target").Number(grab.target); break;
            case Core.Command.RelayRelease release: output.Key("n").Number(release.n); break;
            case Core.Command.DialGrab dial: output.Key("targetUdeg").Number(dial.targetUdeg); break;
        }
        output.EndObject();
    }

    private static void End(JsonOut output, CordEnd end)
    {
        output.BeginObject().Key("k").String(end.k);
        if (end is CordEnd.Hole hole) output.Key("hole").String(hole.hole);
        else if (end is CordEnd.Touch touch) output.Key("term").String(touch.term);
        output.EndObject();
    }

    public static void Cord(JsonOut output, CordView cord)
    {
        output.BeginObject().Key("id").Number(cord.id).Key("a").String(cord.a).Key("b");
        if (cord.b is null) output.Null();
        else output.String(cord.b);
        output.Key("wire").String(cord.wire).EndObject();
    }

    /// <summary>table.ts:106 `{ tick, observables, cords, snapshot }`.</summary>
    public static void View(JsonOut output, StateView view)
    {
        output.BeginObject().Key("tick").Number(view.tick).Key("observables").BeginArray();
        foreach (var row in view.observables) output.BeginObject().Key("name").String(row.name).Key("value").String(row.value).EndObject();
        output.EndArray().Key("cords").BeginArray();
        foreach (var cord in view.cords) Cord(output, cord);
        output.EndArray().Key("snapshot");
        Snapshot(output, view.snapshot);
        output.EndObject();
    }

    /// <summary>machine.ts:731 `snapshot()`, key for key.</summary>
    public static void Snapshot(JsonOut output, State state)
    {
        output.BeginObject()
            .Key("contract").String(state.contract)
            .Key("netlistHash").String(state.netlistHash)
            .Key("profileId").String(state.profileId)
            .Key("profileHash").String(state.profileHash)
            .Key("tick").Number(state.tick)
            .Key("power").Bool(state.power)
            .Key("breakerTripped").Bool(state.breakerTripped)
            .Key("railMv").Number(state.railMv)
            .Key("supplyUa").Number(state.supplyUa)
            .Key("relays").BeginArray();
        foreach (var relay in state.relays)
        {
            output.BeginObject()
                .Key("travel").Number(relay.travel)
                .Key("coilMv").Number(relay.coilMv)
                .Key("coilUa").Number(relay.coilUa)
                .Key("pullInUa").Number(relay.pullInUa)
                .Key("dropOutUa").Number(relay.dropOutUa)
                .Key("band").String(BandNames[(int)relay.band])
                .Key("coilShorted").Bool(relay.coilShorted)
                .Key("set1").BeginObject().Key("nc").Bool(relay.set1.nc).Key("no").Bool(relay.set1.no).EndObject()
                .Key("set2").BeginObject().Key("nc").Bool(relay.set2.nc).Key("no").Bool(relay.set2.no).EndObject()
                .Key("indicatorUa").Number(relay.indicatorUa)
                .Key("held").Bool(relay.held)
                .EndObject();
        }
        output.EndArray().Key("outLamps");
        Lamps(output, state.outLamps);
        output.Key("indLamps");
        Lamps(output, state.indLamps);
        output.Key("buttons").BeginArray();
        foreach (var button in state.buttons)
            output.BeginObject().Key("travel").Number(button.travel).Key("nc").Bool(button.nc).Key("no").Bool(button.no).EndObject();
        output.EndArray().Key("switches").BeginArray();
        foreach (var slide in state.switches)
        {
            output.BeginObject().Key("travel").Number(slide.travel)
                .Key("set1").BeginArray().Bool(slide.set1.Item1).Bool(slide.set1.Item2).EndArray()
                .Key("set2").BeginArray().Bool(slide.set2.Item1).Bool(slide.set2.Item2).EndArray()
                .EndObject();
        }
        output.EndArray().Key("dial").BeginObject().Key("udeg").Number(state.dial.udeg).Key("contact");
        if (state.dial.contact is { } contact) output.Number(contact);
        else output.Null();
        output.Key("mrpm").Number(state.dial.mrpm).Key("held").Bool(state.dial.held).EndObject();
        output.Key("cords").BeginArray();
        foreach (var cord in state.cords)
        {
            output.BeginObject().Key("id").Number(cord.id).Key("a");
            End(output, cord.a);
            output.Key("b");
            End(output, cord.b);
            output.Key("r_uohm").Number(cord.r_uohm).EndObject();
        }
        output.EndArray().Key("terminalMv").BeginArray();
        foreach (var mv in state.terminalMv)
        {
            if (mv is { } value) output.Number(value);
            else output.Null();
        }
        output.EndArray().Key("notes").BeginArray();
        foreach (var note in state.notes)
        {
            output.BeginObject().Key("k").String(note.k);
            if (note is Note.CoilStarved starved)
            {
                output.Key("relay").Number(starved.relay).Key("coilUa").Number(starved.coilUa)
                    .Key("needsUa").Number(starved.needsUa).Key("drops").BeginArray();
                foreach (var drop in starved.drops) output.BeginObject().Key("el").String(drop.el).Key("mv").Number(drop.mv).EndObject();
                output.EndArray();
            }
            else if (note is Note.LampInCoilPath lamp)
            {
                output.Key("relay").Number(lamp.relay).Key("lampMv").Number(lamp.lampMv);
            }
            output.EndObject();
        }
        output.EndArray().Key("flags").BeginObject().Key("chattering").BeginArray();
        foreach (var dev in state.flags.chattering) output.String(Table.ChatterName(dev));
        output.EndArray().Key("overCurrent").Bool(state.flags.overCurrent).Key("nonPortable").Bool(state.flags.nonPortable)
            .EndObject().EndObject();
    }

    private static void Lamps(JsonOut output, State.Lamp[] lamps)
    {
        output.BeginArray();
        foreach (var lamp in lamps)
            output.BeginObject().Key("ua").Number(lamp.ua).Key("milli").Number(lamp.milli).Key("cls").String(LampNames[(int)lamp.cls]).EndObject();
        output.EndArray();
    }

    /// <summary>table.ts:102: `{ ok: true }` plus `cord`, `cords` or `view` when set; `{ ok: false, why, detail }`.</summary>
    public static void Result(JsonOut output, ToolResult result)
    {
        output.BeginObject().Key("ok").Bool(result.ok);
        if (result is ToolResult.Ok ok)
        {
            if (ok.cord is not null)
            {
                output.Key("cord");
                Cord(output, ok.cord);
            }
            if (ok.cords is not null)
            {
                output.Key("cords").BeginArray();
                foreach (var cord in ok.cords) Cord(output, cord);
                output.EndArray();
            }
            if (ok.view is not null)
            {
                output.Key("view");
                View(output, ok.view);
            }
        }
        else if (result is ToolResult.Fail fail)
        {
            output.Key("why").String(fail.why).Key("detail").String(fail.detail);
        }
        output.EndObject();
    }

    /// <summary>
    /// table.ts:787 and engine.ts:35: an accepted batch `{ ok, results, settle, changes }` plus
    /// `view` when given (`{ ...outcome, view }`); a rejection `{ ok, failedAt, result }`.
    /// </summary>
    public static void Outcome(JsonOut output, BatchOutcome outcome, StateView? view = null)
    {
        output.BeginObject().Key("ok").Bool(outcome.ok);
        if (outcome is BatchRejection rejection)
        {
            output.Key("failedAt").Number(rejection.failedAt).Key("result");
            Result(output, rejection.result);
        }
        else if (outcome is BatchOutcome.Accepted accepted)
        {
            output.Key("results").BeginArray();
            foreach (var result in accepted.results) Result(output, result);
            output.EndArray().Key("settle");
            var settle = accepted.settle;
            output.BeginObject().Key("settled").Bool(settle.settled).Key("waitedTicks").Number(settle.waitedTicks).Key("moving");
            Strings(output, settle.moving);
            output.Key("chattering");
            Strings(output, settle.chattering);
            output.Key("dialMrpm").Number(settle.dialMrpm).Key("dialHeld").Bool(settle.dialHeld).Key("lampsMoving");
            Strings(output, settle.lampsMoving);
            output.EndObject().Key("changes").BeginArray();
            foreach (var change in accepted.changes)
            {
                output.BeginObject().Key("name").String(change.name).Key("values");
                Strings(output, change.values);
                output.Key("transitions").Number(change.transitions).Key("elided").Bool(change.elided).EndObject();
            }
            output.EndArray();
            if (view is not null)
            {
                output.Key("view");
                View(output, view);
            }
        }
        output.EndObject();
    }

    public static string Outcome(BatchOutcome outcome)
    {
        var output = new JsonOut();
        Outcome(output, outcome);
        return output.Text;
    }

    public static string Result(ToolResult result)
    {
        var output = new JsonOut();
        Result(output, result);
        return output.Text;
    }

    public static string Snapshot(State state)
    {
        var output = new JsonOut();
        Snapshot(output, state);
        return output.Text;
    }

    public static string Cords(IReadOnlyList<CordView?> cords)
    {
        var output = new JsonOut();
        output.BeginArray();
        foreach (var cord in cords)
        {
            if (cord is null) output.Null();
            else Cord(output, cord);
        }
        output.EndArray();
        return output.Text;
    }

    private static void Strings(JsonOut output, IReadOnlyList<string> values)
    {
        output.BeginArray();
        foreach (var value in values) output.String(value);
        output.EndArray();
    }
}
