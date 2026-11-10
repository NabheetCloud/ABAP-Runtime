INTERFACE if_abap_matcher_callout PUBLIC.
  CONSTANTS: BEGIN OF c_callout_result,
               pass  TYPE i VALUE 0,
               fail  TYPE i VALUE 1,
               abort TYPE i VALUE -1,
             END OF c_callout_result.
  METHODS callout IMPORTING callout_num TYPE i callout_string TYPE string regex TYPE string subject TYPE string
                            current_subject_pos TYPE i current_pattern_pos TYPE i capture_last TYPE i
                            capture_last_len TYPE i start_match_offset TYPE i callout_position TYPE i
                  EXPORTING callout_result TYPE i.
ENDINTERFACE.
