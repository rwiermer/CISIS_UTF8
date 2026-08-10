#include <stdio.h>
#include <string.h>

#include "cisis.h"

#define CISIS_WASM_ERROR_SIZE 160

static char cisis_wasm_error[CISIS_WASM_ERROR_SIZE] = "";

static void set_error(const char *message)
{
    size_t length = strlen(message);
    if (length >= CISIS_WASM_ERROR_SIZE) length = CISIS_WASM_ERROR_SIZE - 1;
    memcpy(cisis_wasm_error, message, length);
    cisis_wasm_error[length] = '\0';
}

static int write_bytes(FILE *stream, const void *data, size_t length)
{
    return length == 0 || fwrite(data, 1, length, stream) == length;
}

static int write_u16(FILE *stream, unsigned long value)
{
    unsigned char bytes[2];
    bytes[0] = (unsigned char)(value & 0xff);
    bytes[1] = (unsigned char)((value >> 8) & 0xff);
    return write_bytes(stream, bytes, sizeof(bytes));
}

static int write_u32(FILE *stream, unsigned long value)
{
    unsigned char bytes[4];
    bytes[0] = (unsigned char)(value & 0xff);
    bytes[1] = (unsigned char)((value >> 8) & 0xff);
    bytes[2] = (unsigned char)((value >> 16) & 0xff);
    bytes[3] = (unsigned char)((value >> 24) & 0xff);
    return write_bytes(stream, bytes, sizeof(bytes));
}

const char *cisis_wasm_last_error(void)
{
    return cisis_wasm_error;
}

int cisis_wasm_export_records(const char *database, int from, int count,
                              const char *output_path)
{
    static const unsigned char magic[4] = { 'C', 'W', 'R', '1' };
    RECSTRU *recp;
    FILE *output;
    LONGX next_mfn;
    LONGX mfn;
    LONGX emitted;
    int field;
    int finalize_failed;
    unsigned char status;

    cisis_wasm_error[0] = '\0';
    if (!database || !database[0] || !output_path || !output_path[0] ||
        from < 1 || count < 0) {
        set_error("invalid record export arguments");
        return -1;
    }

#if FATRAP
    strcpy(fatal_iomsg, "trap");
    if (setjmp(fatal_jumper) != 0) {
        set_error(fatal_iomsg);
        fatal_iomsg[0] = '\0';
        return -2;
    }
#endif

    if (!ndbxs) dbxinit();
    record(0, (char *)database, 0L);
    recp = vrecp[0];
    next_mfn = MF0nxtmfn;

    output = fopen(output_path, "wb");
    if (!output) {
        set_error("cannot create record export output");
#if FATRAP
        fatal_iomsg[0] = '\0';
#endif
        return -3;
    }
    if (!write_bytes(output, magic, sizeof(magic)) || !write_u32(output, 0)) {
        fclose(output);
        set_error("cannot write record export header");
#if FATRAP
        fatal_iomsg[0] = '\0';
#endif
        return -4;
    }

    emitted = 0;
    for (mfn = (LONGX)from; mfn < next_mfn && (!count || emitted < count); mfn++) {
        record(1, (char *)database, mfn);
        recp = vrecp[1];
        if (RECrc == RCEOF) break;
        if (RECrc == RCPDEL) continue;
        if (RECrc != RCNORMAL && RECrc != RCLDEL) continue;

        status = MFRstatus == DELETED ? 1 : 0;
        if (!write_u32(output, (unsigned long)MFRmfn) ||
            !write_bytes(output, &status, 1) ||
            !write_u32(output, (unsigned long)MFRnvf)) {
            fclose(output);
            set_error("cannot write record export leader");
#if FATRAP
            fatal_iomsg[0] = '\0';
#endif
            return -4;
        }
        for (field = 0; field < MFRnvf; field++) {
            if (!write_u16(output, (unsigned long)DIRtag(field)) ||
                !write_u32(output, (unsigned long)DIRlen(field)) ||
                !write_bytes(output, FIELDP(field), (size_t)DIRlen(field))) {
                fclose(output);
                set_error("cannot write record export field");
#if FATRAP
                fatal_iomsg[0] = '\0';
#endif
                return -4;
            }
        }
        emitted++;
    }

    finalize_failed = fseek(output, 4L, SEEK_SET) != 0 ||
        !write_u32(output, (unsigned long)emitted);
    if (fclose(output) != 0) finalize_failed = 1;
    if (finalize_failed) {
        set_error("cannot finalize record export");
#if FATRAP
        fatal_iomsg[0] = '\0';
#endif
        return -5;
    }
#if FATRAP
    fatal_iomsg[0] = '\0';
#endif
    return (int)emitted;
}
