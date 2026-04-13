// Spotify Web API - Remote Control Only (GET + Control)
// These functions read track info and send remote commands to the user's Spotify app
// NEVER transfers playback to the browser - music stays in the user's Spotify app

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string; width: number; height: number }[];
  };
  duration_ms: number;
}

export interface SpotifyPlaybackState {
  is_playing: boolean;
  progress_ms: number;
  item: SpotifyTrack | null;
  device: {
    id: string;
    name: string;
    volume_percent: number;
  } | null;
}

// GET-only: Fetch current playback info without affecting the player
export async function getCurrentPlayback(
  accessToken: string
): Promise<SpotifyPlaybackState | null> {
  const response = await fetch(`${SPOTIFY_API_BASE}/me/player`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 204) {
    // No active playback
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to fetch playback state");
  }

  return response.json();
}

// Remote control: Pause playback on the user's active device
export async function pausePlayback(accessToken: string): Promise<void> {
  await fetch(`${SPOTIFY_API_BASE}/me/player/pause`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

// Remote control: Resume playback on the user's active device
// This does NOT specify a device_id, so it won't transfer playback
export async function getAvailableDevices(accessToken: string): Promise<{ id: string; name: string; is_active: boolean }[]> {
  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/devices`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return [];
  const data = await response.json();
  return data.devices ?? [];
}

export async function resumePlayback(accessToken: string): Promise<void> {
  // Fetch available devices and target the first one explicitly
  // Needed for iOS where Spotify loses "active" status when backgrounded
  const devices = await getAvailableDevices(accessToken);
  const targetDevice = devices.find((d) => d.is_active) ?? devices[0];

  await fetch(`${SPOTIFY_API_BASE}/me/player/play${targetDevice ? `?device_id=${targetDevice.id}` : ""}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

// Remote control: Skip to next track on the user's active device
export async function skipToNext(accessToken: string): Promise<void> {
  await fetch(`${SPOTIFY_API_BASE}/me/player/next`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

// Remote control: Skip to previous track on the user's active device
export async function skipToPrevious(accessToken: string): Promise<void> {
  await fetch(`${SPOTIFY_API_BASE}/me/player/previous`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
