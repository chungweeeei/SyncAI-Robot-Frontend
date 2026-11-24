import { useQuery } from "@tanstack/react-query";

import { fetchHealth } from "@/lib/api/health";
import { queryKeys } from "@/lib/api/query-keys";
import { G23_PROFILE, robotProfile, type RobotProfile } from "@/lib/robot/profile";

/**
 * The robot the sign-in screen draws, asked of /health because the robot
 * state needs the token this screen is there to get.
 *
 * Undefined while the answer is on its way, so the screen draws no robot
 * rather than one it then swaps. Read once: a robot does not change kind
 * under an open page. An unreachable backend falls back to the G23, since
 * the picture is decoration and the form beside it will say what is wrong;
 * a model this console does not know draws none (null).
 */
export function useSignInRobotProfile(): RobotProfile | null | undefined {
  const { data, isError } = useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: Infinity,
  });
  if (isError) return G23_PROFILE;
  return data ? robotProfile(data.robot_model) : undefined;
}
