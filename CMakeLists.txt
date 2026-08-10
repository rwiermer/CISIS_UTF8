cmake_minimum_required(VERSION 3.20)

project(cisis_utf8 LANGUAGES C)

include(CTest)

option(CISIS_BUILD_MX "Build the MX utility" ON)
option(CISIS_BUILD_WXIS "Build the WXIS IsisScript runtime" ON)
option(CISIS_LONGX_32 "Use a 32-bit LONGX for the ISIS1660/wasm32 layout" OFF)
option(CISIS_ENABLE_SANITIZERS "Enable address and undefined behavior sanitizers" OFF)

if(EMSCRIPTEN)
  set(CISIS_LONGX_32 ON CACHE BOOL "Use a 32-bit LONGX" FORCE)
endif()

if(CISIS_LONGX_32 AND NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR
    "CISIS_LONGX_32 stores pointers in LONGX and requires 32-bit pointers. "
    "Use a 32-bit compiler or Emscripten.")
endif()

if(CISIS_LONGX_32)
  set(CISIS_SIXTY_FOUR 1)
else()
  set(CISIS_SIXTY_FOUR 0)
endif()

set(CISIS_COMMON_SOURCES
  cidbx.c
  cib71.c
  cib72.c
  cifm1.c
  cifm2.c
  cifm3.c
  cifst.c
  cigiz.c
  ciifl.c
  ciifu.c
  ciiso.c
  cirec.c
  citrm.c
  ciupd.c
  ciupi.c
  ciutl.c
  ciutf8.c
  ifloadao.c
  mxaot.c
  mxbol.c
  mxrel.c
  mxrun.c
  mxtxt.c)

set(CISIS_MX_SOURCES
  mx.c
  cisisx.c
  cicgi.c
  ${CISIS_COMMON_SOURCES})

set(CISIS_WXIS_SOURCES
  wxis_src/xis.c
  wxis_src/xis_comp.c
  wxis_src/xis_exec.c
  wxis_src/arglist.c
  wxis_src/cgilist.c
  wxis_src/cimsrt.c
  wxis_src/citpv.c
  wxis_src/cixml.c
  wxis_src/easyci.c
  wxis_src/easyfc.c
  wxis_src/freqlist.c
  wxis_src/hide.c
  wxis_src/hlfill.c
  wxis_src/chronometer.c
  cicgi.c
  ${CISIS_COMMON_SOURCES})

function(cisis_configure_target target is_wxis)
  target_include_directories(${target} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/wxis_src)

  target_compile_options(${target} PRIVATE -funsigned-char)
  if(NOT EMSCRIPTEN)
    target_compile_options(${target} PRIVATE -fcommon)
  endif()
  target_compile_definitions(${target} PRIVATE
    CIFFI=0
    LIND=0
    LIND4=0
    ISISXL=1
    ISISXL512=0
    LINDLUX=0
    PROCXSLT=0
    _FILE_OFFSET_BITS=0
    _LARGEFILE64_SOURCE=0
    SIXTY_FOUR=${CISIS_SIXTY_FOUR}
    SUPERISIS=0
    MAXMFRL=0
    CIWTF=1
    INCPROCX=1
    INCPRECX=1
    EXCFMCGI=0
    EXCFMXML=0
    WWWISIS=${is_wxis})

  if(CMAKE_C_COMPILER_ID STREQUAL "GNU")
    target_compile_definitions(${target} PRIVATE _GLIBC_VERSIONED_SOURCE)
  endif()

  if(CISIS_ENABLE_SANITIZERS AND NOT EMSCRIPTEN)
    target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(${target} PRIVATE -fsanitize=address,undefined)
  endif()

  if(NOT MSVC)
    target_link_libraries(${target} PRIVATE m)
  endif()

  if(EMSCRIPTEN)
    target_link_options(${target} PRIVATE
      -sMODULARIZE=1
      -sEXPORT_ES6=1
      -sENVIRONMENT=web,worker,node
      -sFORCE_FILESYSTEM=1
      -sALLOW_MEMORY_GROWTH=1
      -sEXIT_RUNTIME=1
      -sINVOKE_RUN=0
      -sEXPORTED_RUNTIME_METHODS=FS,callMain)
    set_target_properties(${target} PROPERTIES SUFFIX ".mjs")
  endif()
endfunction()

if(CISIS_BUILD_MX)
  add_executable(cisis-mx ${CISIS_MX_SOURCES})
  cisis_configure_target(cisis-mx 0)
endif()

if(CISIS_BUILD_WXIS)
  add_executable(cisis-wxis ${CISIS_WXIS_SOURCES})
  cisis_configure_target(cisis-wxis 1)
endif()

if(BUILD_TESTING AND CISIS_BUILD_WXIS AND NOT EMSCRIPTEN)
  add_test(NAME wxis-hello
    COMMAND cisis-wxis IsisScript=${CMAKE_CURRENT_SOURCE_DIR}/wxis_src/examples/hello.xis)
  set_tests_properties(wxis-hello PROPERTIES
    PASS_REGULAR_EXPRESSION "Content-type: text/html.*Hello world!")
endif()

if(BUILD_TESTING AND CISIS_BUILD_MX AND CISIS_BUILD_WXIS
   AND CISIS_LONGX_32 AND NOT EMSCRIPTEN)
  add_test(NAME cisis-compatibility-smoke
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/tests/native/compatibility-smoke.sh
      $<TARGET_FILE:cisis-mx>
      $<TARGET_FILE:cisis-wxis>
      ${CMAKE_CURRENT_SOURCE_DIR})
endif()
