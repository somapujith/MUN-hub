/**
 * Helpers for the organizer check-in scanner's camera access. Kept free of
 * React and of direct `document`/`navigator` reads so they can be tested
 * under Node.
 */

interface FeaturePolicyLike {
  allowsFeature?: (feature: string) => boolean;
}

interface PolicyDocumentLike {
  permissionsPolicy?: FeaturePolicyLike;
  featurePolicy?: FeaturePolicyLike;
}

/**
 * False when the document's Permissions-Policy turns the camera off. In that
 * case getUserMedia always fails and no browser setting can change it, so the
 * scanner shouldn't be offered at all. Browsers that don't expose the policy
 * (Firefox, Safari) report true and getUserMedia decides.
 */
export function cameraAllowedByPolicy(doc: unknown): boolean {
  const policyDocument = doc as PolicyDocumentLike | null | undefined;
  const policy = policyDocument?.permissionsPolicy ?? policyDocument?.featurePolicy;
  if (typeof policy?.allowsFeature !== "function") return true;
  try {
    return policy.allowsFeature("camera");
  } catch {
    return true;
  }
}

export type CameraPermissionState = "granted" | "denied" | "prompt" | "unknown";

interface PermissionsNavigatorLike {
  permissions?: { query?: (descriptor: { name: string }) => Promise<{ state: string }> };
}

/** The camera permission state, or "unknown" where the browser can't query it (Firefox, older Safari). */
export async function readCameraPermission(nav: unknown): Promise<CameraPermissionState> {
  const query = (nav as PermissionsNavigatorLike | null | undefined)?.permissions?.query;
  if (typeof query !== "function") return "unknown";
  try {
    const status = await query.call((nav as PermissionsNavigatorLike).permissions, { name: "camera" });
    const state = status?.state;
    return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

export interface CameraFailure {
  /** True when retrying can't work, so the Scan button should be hidden. */
  blocked: boolean;
  message: string;
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    return String((error as { name: unknown }).name);
  }
  return "";
}

/**
 * Turns a getUserMedia rejection into what the panel shows. `stateBefore` is
 * the camera permission state read before the request: a NotAllowedError when
 * the state was already "denied" means the browser refused without asking
 * (a site policy or a saved "block"), so asking the user to allow access in
 * the prompt would be wrong — there is no prompt.
 */
export function describeCameraFailure(error: unknown, stateBefore: CameraPermissionState): CameraFailure {
  const name = errorName(error);
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (stateBefore === "denied") {
      return {
        blocked: true,
        message:
          "The camera is blocked for this site on this device. Type the code instead, or allow the camera in your browser's site settings and reload.",
      };
    }
    return { blocked: false, message: "Camera access wasn't allowed. Allow camera access, or type the code instead." };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { blocked: true, message: "No camera was found on this device. Type the code instead." };
  }
  if (name === "NotReadableError") {
    return {
      blocked: false,
      message: "The camera is being used by another app. Close it and try again, or type the code instead.",
    };
  }
  return { blocked: false, message: "Couldn't open the camera. Allow camera access, or type the code instead." };
}
