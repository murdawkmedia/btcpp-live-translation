# Capture Windows/vMix audio

Use Chrome or Edge on the Windows machine running vMix. Run this standalone
app from its own source directory. The same repository runs on Windows and Linux.
This guide does not install drivers or modify vMix automatically.

## First soundcheck: desktop audio

1. Start the app, open the operator page at localhost or its configured HTTPS
   address, and choose **Windows desktop / shared tab**.
2. Click **Check audio input**. In the browser chooser, select a screen or tab
   offering audio and enable **Share audio / Share system audio** when offered.
   A tab captures that tab; use a screen/system-audio option for vMix audio.
3. Play speech through the intended vMix/Windows output. Confirm the input meter
   moves. The local check does not send audio to the server or a provider.
4. Stop the soundcheck. With live providers configured, click **Choose audio &
   go live**, select the same source and enable sharing again.

The browser requires an explicit source choice each time. It may offer
different audio options by browser, selected surface and Windows version.
If vMix has audio but the meter is silent, use an explicit audio-input route
below. Browser selection success alone does not prove the intended feed is
present. No video is uploaded by this app.

## Preferred event route: a dedicated vMix bus

1. In vMix **Audio Bus Manager**, assign the Main Stage speech inputs to an
   unused bus, for example A. Leave music, break videos, notifications and
   translated Korean playback out of this bus. Keep the existing Master output
   assignments intact.
2. In **Settings → Audio Outputs**, route the chosen bus to an available
   loopback-capable device or installed virtual cable's playback endpoint.
3. In this app choose **vMix bus / audio input**, then **Find audio inputs**.
   The browser requests audio permission so it can display device names.
4. Select the corresponding recording endpoint and run **Check audio input**.
   With VB-CABLE, audio sent to **CABLE Input** is forwarded to **CABLE Output**;
   verify the actual device names installed on the machine.
5. Play a real Main Stage speech feed. Check levels, clipping and silence at
   breaks. Start live processing only after this source passes a soundcheck.
6. Listen to Korean on a separate phone with headphones. Keep that output out
   of the source bus to prevent re-transcribing generated speech.

If a virtual driver is needed, arrange installation and any reboot before the
event. An existing USB audio interface with suitable routing can be used
instead. No driver was installed or Windows machine accessed in development.

## Rehearse the complete route

Use a 20–30 minute technical recording and a fluent Korean reviewer. Test:

- Main Stage speech is audible in the capture meter; unrelated sources stay out.
- Numbers, negations, names and Bitcoin terms survive recognition/translation.
- Korean captions and speech remain understandable without a growing backlog.
- Stop finishes the last sentence; restart does not replay old speech.
- Phones resume after screen lock, network changes and interruptions.
- The public attendee QR works on cellular as well as venue Wi-Fi.
- Operator, backup operator and network owner know their responsibilities.

Sources checked on 2026-10-22:

- [vMix Audio Outputs](https://www.vmix.com/help29/AudioOutputs.html)
- [vMix Audio Bus Manager](https://www.vmix.com/help29/AudioBusManager.html)
- [Windows loopback recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)
- [Chrome screen sharing controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls)
- [VB-CABLE](https://vb-audio.com/Cable/)
