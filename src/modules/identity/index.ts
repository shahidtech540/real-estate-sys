export type { Actor, RequestMeta } from "./commands";
export {
  changePassword,
  createUser,
  login,
  logout,
  resetPassword,
  setLanguage,
  unlockUser,
  updateUser,
} from "./commands";
export {
  getUser,
  listUsers,
  me,
  refresh,
  sessionInfo,
  type PageDto,
} from "./queries";
export {
  getPageSession,
  requireRequestSession,
  type AuthedRequest,
} from "./guards";
export type { SessionContext } from "./session-service";
export type { UserDto, SessionInfoDto, SessionUserDto } from "./dto";

import type { SessionContext } from "./session-service";
import type { Actor } from "./commands";

/** The actor for a command: derived from the session, never from the request body. */
export function actorFromContext(context: SessionContext): Actor {
  return {
    id: context.user.id,
    name: context.user.name,
    email: context.user.email,
    role: context.user.role,
  };
}
