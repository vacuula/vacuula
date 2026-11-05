import { RequireRobot } from '../require/requireRobot'
import RobotSwitcher from './robotSwitcher'
import { RobotStateIcon, RobotStatusBadges } from './robotInfo'

export default function Topbar() {
    return (
        <RobotSwitcher
            icon={
                <RequireRobot>
                    <RobotStateIcon />
                </RequireRobot>
            }
        >
            <RequireRobot>
                <RobotStatusBadges />
            </RequireRobot>
        </RobotSwitcher>
    )
}














// import styles from './topbar.module.scss'
// import { MdCleaningServices, MdError, MdWarning } from 'react-icons/md'
// import { IoMdPause, IoMdPlay } from 'react-icons/io'
// import { TbChargingPile, TbChevronDown } from 'react-icons/tb'
// import { FaAnchor } from "react-icons/fa";
// import Battery from '../battery/Battery'
// import { useApp } from '../../context/useApp'
// import { useRobot } from '../../context/useRobot'
// import { useEffect, useRef, useState, type JSX } from 'react'
// import { GiNightSleep } from "react-icons/gi"
// import { RobotType, type Robot } from '../../types'
// import { BasicState, resolveRobotState } from '../../utils/state'
// import type { IconType } from 'react-icons'
// import { GoDownload } from "react-icons/go";
// import { FaCloudDownloadAlt } from "react-icons/fa";
// import { RiTestTubeFill } from "react-icons/ri";
// let onlineTimeout: number;

// // TODO: mock — replace with robots list from context once wired up
// const MOCK_ROBOTS = [
//     { serial: '2046LB01A11113365', name: 'Living Room Bot' },
//     { serial: 'GPC23118-40bd32d13ac7', name: 'Upstairs Bot' },
//     { serial: 'MOCK-SERIAL-003', name: 'Basement Bot' },
// ]


// import { FaCopy } from "react-icons/fa";
// import { FaMagnifyingGlassLocation } from "react-icons/fa6";
// import { MdOutlineExplore } from "react-icons/md";
// import { FaCloudUploadAlt } from "react-icons/fa";

// const basicStateIcons: Record<BasicState, IconType> = {
//     [BasicState.INVALID]: MdError,
//     [BasicState.ERROR]: MdError,
//     [BasicState.PAUSED]: IoMdPause,
//     [BasicState.IDLE]: GiNightSleep,
//     [BasicState.DOCKING]: GoDownload,
//     [BasicState.CLEANING]: MdCleaningServices,
//     [BasicState.CLEANING_STANDBY]: MdCleaningServices, // ?
//     [BasicState.UPDATING]: FaCloudDownloadAlt,
//     [BasicState.TEST]: RiTestTubeFill,
    
//     // gen3 only
//     [BasicState.COPYING_LOGS]: FaCopy,
//     [BasicState.RECOVERING_LOCATION]: FaMagnifyingGlassLocation,
//     [BasicState.EXPLORING_MAP]: MdOutlineExplore,
//     [BasicState.ACQUIRING_PERSISTENT_MAP_IDS]: FaCloudDownloadAlt,
//     [BasicState.CREATING_UPLOADING_MAP]: FaCloudUploadAlt,
//     [BasicState.SUSPENDED_EXPLORATION]: IoMdPause,
// }

// function test(state: BasicState) {
//     return basicStateIcons[state];
// }



// export default function Topbar() {
//     const { lastHeartbeat } = useApp()
//     const { robot } = useRobot()

//     const [isOnline, setIsOnline] = useState(false)
//     const [isOpen, setIsOpen] = useState(false)
//     const containerRef = useRef<HTMLDivElement>(null)

//     useEffect(() => {
//         clearTimeout(onlineTimeout)
//         setIsOnline(true)
//         onlineTimeout = setTimeout(() => setIsOnline(false), 30 * 1000)
//     }, [lastHeartbeat])

//     // close on outside click
//     useEffect(() => {
//         if (!isOpen) return;
//         const handleClick = (e: MouseEvent) => {
//             if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
//                 setIsOpen(false)
//             }
//         }
//         document.addEventListener('mousedown', handleClick)
//         return () => document.removeEventListener('mousedown', handleClick)
//     }, [isOpen])

//     function isDocked(robot: Robot) {
//         if (robot.type === RobotType.NeatoGen3) return robot.details.isDocked;
//         if (robot.type === RobotType.NeatoGen4) return robot.details.is_docked;
//     }

//     function isCharging(robot: Robot) {
//         if (robot.type === RobotType.NeatoGen3) return robot.details.isCharging;
//         if (robot.type === RobotType.NeatoGen4) return robot.details.is_charging;
//     }

//     const StateIcon = test(resolveRobotState(robot));
//     return (
//         <div className={styles.container} ref={containerRef}>
//             <button
//                 className={styles.topbar}
//                 onClick={() => setIsOpen(o => !o)}
//                 aria-label="Select robot"
//                 aria-expanded={isOpen}
//             >
//                 {/* <GiNightSleep size={25} fill="#1edd88" className={styles.pulseDot} /> */}
//                 <StateIcon size={25} fill="#1edd88" className={styles.pulseDot} />
//                 <span className={styles.name}>{robot.name}</span>

//                 <div className={styles.right}>
//                     {robot.error && <MdError size={16} className={styles.iconErr} />}
//                     {robot.alert && <MdWarning size={16} className={styles.iconWarn} />}
//                     {isDocked(robot) && (
//                         <TbChargingPile size={15} className={styles.iconDocked} title="Docked" />
//                     )}
//                     <Battery percentage={robot.details?.charge} isCharging={isCharging(robot)} />
//                     <TbChevronDown
//                         size={14}
//                         className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
//                         aria-hidden="true"
//                     />
//                 </div>
//             </button>

//             {isOpen && (
//                 <div className={styles.dropdown} role="listbox">
//                     {MOCK_ROBOTS.map((r) => (
//                         <button
//                             key={r.serial}
//                             role="option"
//                             aria-selected={r.serial === robot.serial}
//                             className={`${styles.dropdownItem} ${r.serial === robot.serial ? styles.dropdownItemActive : ''}`}
//                             onClick={() => {
//                                 console.log('TODO: switch to robot', r.serial)
//                                 setIsOpen(false)
//                             }}
//                         >
//                             <span className={styles.dropdownName}>{r.name}</span>
//                             {r.serial === robot.serial && <span className={styles.dropdownCheck}>✓</span>}
//                         </button>
//                     ))}
//                 </div>
//             )}
//         </div>
//     )
// }