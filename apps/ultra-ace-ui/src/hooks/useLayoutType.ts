import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { responsiveWidth } from 'react-native-responsive-dimensions'

const getLayoutType = (): any => {
  const windowWidth = responsiveWidth(100)

  const isWeb = Platform.OS === 'web'
  const isNative = !isWeb
  const isIOS = Platform.OS === 'ios'
  const superSmallDesktopBreakpoint = 800
  const smallDesktopBreakpoint = 1100
  const mediumDesktopBreakpoint = smallDesktopBreakpoint * 1.2
  const largeDesktopBreakpoint = smallDesktopBreakpoint * 1.5

  const isDesktop = windowWidth > superSmallDesktopBreakpoint

  const isDesktopWeb = isDesktop && isWeb
  const isMobile = !isDesktop
  const isMobileWeb = isMobile && isWeb
  const isMobileNative = isMobile && !isWeb
  const isDesktopNative = isDesktop && !isWeb

  const isSuperSmallDesktop =
    windowWidth > superSmallDesktopBreakpoint && windowWidth < smallDesktopBreakpoint
  const isSmallDesktop =
    windowWidth > smallDesktopBreakpoint && windowWidth < mediumDesktopBreakpoint
  const isMediumDesktop = windowWidth > mediumDesktopBreakpoint
  const isLargeDesktop = windowWidth > largeDesktopBreakpoint

  const sidebarWidth = windowWidth > 1350 ? 400 : 320

  const drawerWidth = 190
  return {
    isWeb,
    isNative,
    isIOS,
    superSmallDesktopBreakpoint,
    smallDesktopBreakpoint,
    mediumDesktopBreakpoint,
    largeDesktopBreakpoint,
    isDesktop,
    isSuperSmallDesktop,
    isSmallDesktop,
    isMediumDesktop,
    isLargeDesktop,
    isDesktopWeb,
    isMobile,
    isMobileWeb,
    isMobileNative,
    isDesktopNative,
    sidebarWidth,
    drawerWidth,
    windowWidth,
  }
}

export const {
  isWeb,
  isNative,
  isIOS,
  isTauri,

  superSmallDesktopBreakpoint,
  smallDesktopBreakpoint,
  mediumDesktopBreakpoint,
  largeDesktopBreakpoint,
  isDesktop,
  isSuperSmallDesktop,
  isSmallDesktop,
  isMediumDesktop,
  isLargeDesktop,
  isDesktopWeb,
  isMobile,
  isMobileWeb,
  isMobileNative,
  sidebarWidth,
  drawerWidth,
  windowWidth,
} = getLayoutType()

export default () => {
  const [layoutType, setLayoutType] = useState(getLayoutType())

  useEffect(() => {
    if (isWeb) {
      const handleResize = () => {
        setLayoutType(getLayoutType())
      }
      window.addEventListener('resize', handleResize)
      return () => {
        window.removeEventListener('resize', handleResize)
      }
    }
  }, [])

  return layoutType
}
