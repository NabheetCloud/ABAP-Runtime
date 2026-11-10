INTERFACE if_t100_message PUBLIC.
  TYPES: BEGIN OF ty_t100key,
           msgid TYPE c LENGTH 20,
           msgno TYPE n LENGTH 3,
           attr1 TYPE c LENGTH 255,
           attr2 TYPE c LENGTH 255,
           attr3 TYPE c LENGTH 255,
           attr4 TYPE c LENGTH 255,
         END OF ty_t100key.
  CONSTANTS: BEGIN OF default_textid,
               msgid TYPE c LENGTH 20 VALUE '',
               msgno TYPE n LENGTH 3 VALUE '000',
               attr1 TYPE c LENGTH 255 VALUE '',
               attr2 TYPE c LENGTH 255 VALUE '',
               attr3 TYPE c LENGTH 255 VALUE '',
               attr4 TYPE c LENGTH 255 VALUE '',
             END OF default_textid.
  DATA t100key TYPE ty_t100key.
ENDINTERFACE.
