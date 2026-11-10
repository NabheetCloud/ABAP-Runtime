INTERFACE if_abap_behv_message PUBLIC.
  INTERFACES if_message.
  TYPES t_severity TYPE c LENGTH 1.
  CONSTANTS:
    BEGIN OF severity,
      error       TYPE t_severity VALUE 'E',
      warning     TYPE t_severity VALUE 'W',
      information TYPE t_severity VALUE 'I',
      success     TYPE t_severity VALUE 'S',
      none        TYPE t_severity VALUE ' ',
    END OF severity.
  DATA m_severity TYPE t_severity.
ENDINTERFACE.
